import type { Context } from '@deepseek-ai/cordis';
import type { SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-system-prompt';

import { towerWritePreExecute } from './guard.js';
import { TOWER_MODE_MAIN_DENY } from './profiles.js';
import { protocolAgentId } from './runtime.js';

/** Compact system-prompt announcement (full manual stays on /tower on). */
export const TOWER_PROMPT_GUIDANCE = [
  'This deployment has the dsh-tower plugin enabled (experimental).',
  'Tower coordinates isolated git-worktree missions with review and merge hard gates.',
  'Main-agent tools: TowerInit, TowerPlan, TowerSpawn, TowerMerge, TowerTeardown;',
  'shared: TowerSend, TowerInbox, TowerFinding, TowerReview, TowerMission, TowerStatus.',
  'User entry: /tower on | /tower off | /tower <objective> | /tower status | /tower teardown.',
  'Do not hand-edit `.dsh-tower/`; do not invent custom session events for progress.',
  'When the user asks for tower / multi-worktree missions with a merge gate, use these tools.',
].join(' ');

/**
 * Wire DSH-native seams: systemPrompt section, tools/pre-execute waterfall,
 * TodoList deny while mode active, and subagent/end for rate-limit + sparse inject.
 */
export function installNativeSeams(ctx: Context): void {
  const tower = ctx.tower;

  if (tower.announceToAgent) {
    const systemPrompt = ctx.get('systemPrompt') as
      | {
          section: (s: {
            name: string;
            order: number;
            text: string | (() => string | Promise<string>);
          }) => () => void;
        }
      | undefined;
    systemPrompt?.section({
      name: 'plugin:dsh-tower',
      order: 260,
      text: () => {
        // Dynamic section: note when any session has mode active is process-local;
        // per-request mode detail still comes from /tower inject.
        return TOWER_PROMPT_GUIDANCE;
      },
    });
  }

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next) => {
    const sessionId =
      exec.agent !== undefined ? String(exec.agent.session.id) : undefined;
    if (
      sessionId !== undefined &&
      tower.isActive(sessionId) &&
      protocolAgentId(exec.agent) === 'main' &&
      TOWER_MODE_MAIN_DENY.has(exec.name)
    ) {
      return {
        kind: 'deny' as const,
        reason:
          'TodoList is denied in tower mode — track missions with TowerPlan / TowerMission / TowerStatus.',
      };
    }

    const deny = await towerWritePreExecute(ctx, exec);
    if (deny !== undefined) return { kind: 'deny' as const, reason: deny.reason };
    return next();
  });

  ctx.on('subagent/end', (info: SubagentRunEndInfo) => {
    tower.rateLimit.releaseChild(String(info.id));
  });
}
