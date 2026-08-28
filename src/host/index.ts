import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-commands';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-tools';
import Schema from 'schemastery';

import { registerTowerCommand } from './command.js';
import { isTowerEnabled } from './flag.js';
import { towerWriteGuard, towerWritePreExecute } from './guard.js';
import { TowerRateLimit } from './rateLimit.js';
import { registerTowerTools } from './tools/index.js';

export const name = 'dsh-tower';
export const inject = ['tools', 'commands', 'subagents'] as const;

export interface Config {
  /** Enable Tower tools (also via DSH_EXPERIMENTAL_TOWER=1). Default false. */
  experimental?: boolean;
  /** Inflight spawn cap (default 8). */
  inflightCap?: number;
}

export const Config: Schema<Config> = Schema.object({
  experimental: Schema.boolean()
    .default(false)
    .description('Enable Tower tools and /tower (also via env DSH_EXPERIMENTAL_TOWER=1).'),
  inflightCap: Schema.number()
    .default(8)
    .description('Max concurrent tower worker/reviewer spawns.'),
});

export function apply(ctx: Context, config: Config = {}): void {
  if (!isTowerEnabled(config)) return;

  const rateLimit = new TowerRateLimit(config.inflightCap ?? 8);
  registerTowerTools(ctx, rateLimit);
  registerTowerCommand(ctx);
  ctx.tools.guard(towerWriteGuard);

  // Prefer async pre-execute when the waterfall is available.
  try {
    const anyCtx = ctx as Context & {
      on?: (
        event: string,
        listener: (...args: never[]) => unknown,
      ) => void;
    };
    anyCtx.on?.('tools/pre-execute' as never, (async (
      execution: Parameters<typeof towerWritePreExecute>[0],
      next: () => Promise<{ kind: string; reason?: string }>,
    ) => {
      const deny = await towerWritePreExecute(execution);
      if (deny !== undefined) return { kind: 'deny', reason: deny.reason };
      return next();
    }) as never);
  } catch {
    // Sync guard remains as fallback.
  }
}
