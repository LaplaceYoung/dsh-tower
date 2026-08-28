import type { Context } from '@deepseek-ai/cordis';
import type { SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-system-prompt';

import { towerWritePreExecute } from './guard.js';
import type { TowerRateLimit } from './rateLimit.js';

/** Compact system-prompt announcement (full manual stays on /tower on). */
export const TOWER_PROMPT_GUIDANCE = [
  'This deployment has the dsh-tower plugin enabled (experimental).',
  'Tower coordinates isolated git-worktree missions with review and merge hard gates.',
  'Main-agent tools: TowerInit, TowerPlan, TowerSpawn, TowerMerge, TowerTeardown;',
  'shared: TowerSend, TowerInbox, TowerFinding, TowerReview, TowerMission, TowerStatus.',
  'User entry: /tower on | /tower <objective> | /tower status | /tower teardown.',
  'Do not hand-edit `.dsh-tower/`; do not invent custom session events for progress.',
  'When the user asks for tower / multi-worktree missions with a merge gate, use these tools.',
].join(' ');

/**
 * Wire DSH-native seams: systemPrompt section, tools/pre-execute waterfall,
 * and subagent/end for rate-limit release.
 */
export function installNativeSeams(
  ctx: Context,
  rateLimit: TowerRateLimit,
  options: { readonly announceToAgent?: boolean } = {},
): void {
  if (options.announceToAgent !== false) {
    try {
      const sp = (
        ctx as Context & {
          systemPrompt?: {
            section: (s: {
              name: string;
              order: number;
              text: string | (() => string | Promise<string>);
            }) => () => void;
          };
        }
      ).systemPrompt;
      sp?.section({
        name: 'plugin:dsh-tower',
        order: 260,
        text: TOWER_PROMPT_GUIDANCE,
      });
    } catch {
      // systemPrompt absent — skip
    }
  }

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next) => {
    const deny = await towerWritePreExecute(exec);
    if (deny !== undefined) return { kind: 'deny' as const, reason: deny.reason };
    return next();
  });

  ctx.on('subagent/end', (info: SubagentRunEndInfo) => {
    rateLimit.releaseChild(String(info.id));
  });
}
