#!/usr/bin/env node
/**
 * Non-UI mount smoke: prove apply() registers Tower tools + /tower when the
 * experimental flag is on, and registers nothing when off.
 * Uses a real Cordis Context with stubbed DSH services.
 */
import { Context } from '@deepseek-ai/cordis';
import { apply } from '../lib/host/index.js';

function stubServices(root, bag) {
  root.provide('tools', {
    register(def) {
      bag.tools.push(def.name);
      return () => {};
    },
    guard() {
      bag.guards += 1;
      return () => {};
    },
  });
  root.provide('commands', {
    register(def) {
      bag.commands.push(def.name);
      return () => {};
    },
  });
  root.provide('subagents', {
    startContinuable() {
      throw new Error('not used in mount smoke');
    },
  });
  root.provide('systemPrompt', {
    section(s) {
      bag.listeners.push(['section', s.name]);
      return () => {};
    },
  });
}

async function mount(config) {
  const bag = { tools: [], commands: [], listeners: [], guards: 0, hasTower: false };
  const root = new Context();
  stubServices(root, bag);
  // Patch ctx.on via a thin plugin wrap: apply registers listeners on the fiber ctx.
  await root.plugin({
    name: 'dsh-tower-smoke',
    inject: ['tools', 'commands', 'subagents', 'systemPrompt'],
    apply(ctx, cfg) {
      const origOn = ctx.on.bind(ctx);
      ctx.on = (event, ...rest) => {
        bag.listeners.push(['on', event]);
        return origOn(event, ...rest);
      };
      apply(ctx, cfg);
      bag.hasTower = cfg.experimental === true || process.env.DSH_EXPERIMENTAL_TOWER === '1'
        ? (() => {
            try {
              return ctx.tower !== undefined && typeof ctx.tower.enter === 'function';
            } catch {
              return false;
            }
          })()
        : false;
    },
  }, config);
  return bag;
}

const prev = process.env.DSH_EXPERIMENTAL_TOWER;
delete process.env.DSH_EXPERIMENTAL_TOWER;

const off = await mount({ experimental: false });
if (off.tools.length !== 0 || off.commands.length !== 0 || off.hasTower) {
  console.error('FAIL: tools/service registered while experimental=false', off);
  process.exit(1);
}

process.env.DSH_EXPERIMENTAL_TOWER = '1';
const on = await mount({});
const expected = [
  'TowerInit',
  'TowerPlan',
  'TowerSpawn',
  'TowerSend',
  'TowerInbox',
  'TowerFinding',
  'TowerReview',
  'TowerMission',
  'TowerMerge',
  'TowerStatus',
  'TowerTeardown',
];
for (const name of expected) {
  if (!on.tools.includes(name)) {
    console.error('FAIL: missing tool', name, on.tools);
    process.exit(1);
  }
}
if (!on.commands.includes('tower')) {
  console.error('FAIL: /tower command not registered', on.commands);
  process.exit(1);
}
if (!on.hasTower) {
  console.error('FAIL: ctx.tower service missing');
  process.exit(1);
}
const events = on.listeners.filter((x) => x[0] === 'on').map((x) => x[1]);
if (!events.includes('tools/pre-execute') || !events.includes('subagent/end')) {
  console.error('FAIL: native listeners missing', events);
  process.exit(1);
}
if (!on.listeners.some((x) => x[0] === 'section' && x[1] === 'plugin:dsh-tower')) {
  console.error('FAIL: systemPrompt section missing', on.listeners);
  process.exit(1);
}

if (prev === undefined) delete process.env.DSH_EXPERIMENTAL_TOWER;
else process.env.DSH_EXPERIMENTAL_TOWER = prev;

console.log(
  JSON.stringify(
    {
      ok: true,
      tools: on.tools.length,
      command: 'tower',
      service: 'tower',
      listeners: events,
      offTools: off.tools.length,
    },
    null,
    2,
  ),
);
