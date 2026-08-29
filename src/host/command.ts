import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-commands';
import type { Agent } from '@deepseek-ai/dsh-agent';

import { TowerStore, resolveTowerRepoRoot } from '../protocol/index.js';
import { sessionCwd } from './runtime.js';

/**
 * Register `/tower` slash command.
 * Routes: empty|status → status; on → enter + full inject; off → exit + exit inject;
 * teardown → protocol teardown + exit; other text → objective + enter + full inject.
 */
export function registerTowerCommand(ctx: Context): void {
  ctx.commands.register({
    name: 'tower',
    description: 'Tower mode: on | off | status | teardown | <objective>',
    input: { hint: 'on | off | status | teardown | <objective>' },
    handler: async ({
      agent,
      rawInput,
    }: {
      agent: Agent;
      rawInput?: string;
    }) => {
      const input = (rawInput ?? '').trim();
      const cwd = sessionCwd(agent);
      const store = new TowerStore(resolveTowerRepoRoot(cwd));
      const tower = ctx.tower;
      const sessionId = String(agent.session.id);

      if (input === '' || input === 'status') {
        const mode = tower.isActive(sessionId) ? 'active' : 'inactive';
        if (!(await store.isInitialized())) {
          return {
            kind: 'success' as const,
            text: `tower mode: ${mode}; workspace not initialized — run \`/tower on\` or TowerInit first`,
          };
        }
        const state = await store.load();
        const rl = tower.rateLimit.snapshot();
        const lines = state.missions.map(
          (m) => `- ${m.id} ${m.title} [${m.status}] owner=${m.owner ?? '—'}`,
        );
        return {
          kind: 'success' as const,
          text: [
            `mode: ${mode}`,
            `base: ${state.base}`,
            `roster: ${state.roster.agents.length}`,
            `rate-limit: ${rl.inflight}/${rl.budget} (cap ${rl.cap})`,
            'missions:',
            ...(lines.length > 0 ? lines : ['(none)']),
          ].join('\n'),
        };
      }

      if (input === 'off') {
        const wasActive = tower.isActive(sessionId);
        tower.exit(sessionId);
        if (!wasActive) {
          return { kind: 'success' as const, text: 'tower mode was already inactive' };
        }
        const injected = await tower.inject(agent, 'exit');
        return {
          kind: 'success' as const,
          text: injected.ok
            ? 'tower mode exited — restrictions lifted; tools remain available while experimental is on'
            : `tower mode exited (steer unavailable). ${injected.text.slice(0, 400)}`,
        };
      }

      if (input === 'teardown') {
        if (!(await store.isInitialized())) {
          return { kind: 'error' as const, text: 'tower is not initialized' };
        }
        const report = await store.teardown();
        tower.exit(sessionId);
        tower.clearRosterCache(store.repoRoot);
        await tower.inject(agent, 'exit');
        return {
          kind: 'success' as const,
          text: ['teardown:', ...report.map((line) => `- ${line}`), 'tower mode exited'].join(
            '\n',
          ),
        };
      }

      if (input === 'on' || input.length > 0) {
        tower.enter(sessionId);
        const objectiveBlock =
          input === 'on'
            ? ''
            : `\n\n## Current objective\n${input}\n\nStart with TowerInit (if needed), clarify, TowerPlan, then TowerSpawn.\n`;
        const injected = await tower.inject(agent, 'full', objectiveBlock);
        return {
          kind: 'success' as const,
          text: injected.ok
            ? input === 'on'
              ? 'tower mode entered — full reminder injected. Use TowerInit → Plan → Spawn. Do not write product code yourself.'
              : `tower mode entered. Objective accepted. Proceed: TowerInit → clarify → TowerPlan → TowerSpawn.\n\nObjective: ${input}`
            : input === 'on'
              ? `tower mode entered (steer unavailable — include in next turn):\n\n${injected.text.slice(0, 2000)}…`
              : `tower mode entered (steer unavailable). Objective: ${input}`,
        };
      }

      return {
        kind: 'error' as const,
        text: 'usage: /tower on | off | status | teardown | <objective>',
      };
    },
  });
}
