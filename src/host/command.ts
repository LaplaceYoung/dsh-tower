import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-commands';
import type { Agent } from '@deepseek-ai/dsh-agent';

import { TowerStore, resolveTowerRepoRoot } from '../protocol/index.js';
import { loadTowerSkillMarkdown } from './briefing.js';
import { sessionCwd } from './runtime.js';

/**
 * Register `/tower` slash command.
 * Routes: empty|status → status summary; on → inject mode skill; teardown → teardown tool path;
 * other text → treat as objective + inject skill.
 */
export function registerTowerCommand(ctx: Context): void {
  ctx.commands.register({
    name: 'tower',
    description: 'Tower mode: on | status | teardown | <objective>',
    input: { hint: 'on | status | teardown | <objective>' },
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

      if (input === '' || input === 'status') {
        if (!(await store.isInitialized())) {
          return {
            kind: 'success' as const,
            text: 'tower is not initialized in this repository — run `/tower on` or TowerInit first',
          };
        }
        const state = await store.load();
        const lines = state.missions.map(
          (m) => `- ${m.id} ${m.title} [${m.status}] owner=${m.owner ?? '—'}`,
        );
        return {
          kind: 'success' as const,
          text: [
            `base: ${state.base}`,
            `roster: ${state.roster.agents.length}`,
            'missions:',
            ...(lines.length > 0 ? lines : ['(none)']),
          ].join('\n'),
        };
      }

      if (input === 'teardown') {
        if (!(await store.isInitialized())) {
          return { kind: 'error' as const, text: 'tower is not initialized' };
        }
        const report = await store.teardown();
        return {
          kind: 'success' as const,
          text: ['teardown:', ...report.map((line) => `- ${line}`)].join('\n'),
        };
      }

      if (input === 'on' || input.length > 0) {
        const skill = await loadTowerSkillMarkdown();
        const objectiveBlock =
          input === 'on'
            ? ''
            : `\n\n## Current objective\n${input}\n\nStart with TowerInit (if needed), clarify, TowerPlan, then TowerSpawn.\n`;
        const payload = `${skill}${objectiveBlock}`;
        // Steer the agent with the operating manual without inventing session events.
        try {
          const { createUserMessage } = await import('@deepseek-ai/dsh-llm');
          agent.steer(
            createUserMessage({
              content: [{ type: 'text', text: payload }],
              source: { kind: 'user' },
            }),
          );
        } catch {
          return {
            kind: 'success' as const,
            text:
              input === 'on'
                ? `tower mode reminder (steer unavailable — include in next turn):\n\n${payload.slice(0, 2000)}…`
                : `tower objective accepted (steer unavailable). Objective: ${input}`,
          };
        }
        return {
          kind: 'success' as const,
          text:
            input === 'on'
              ? 'tower mode reminder injected — use TowerInit → Plan → Spawn. Do not write product code yourself.'
              : `tower objective accepted. Reminder injected. Proceed: TowerInit → clarify → TowerPlan → TowerSpawn.\n\nObjective: ${input}`,
        };
      }

      return { kind: 'error' as const, text: 'usage: /tower on | status | teardown | <objective>' };
    },
  });
}
