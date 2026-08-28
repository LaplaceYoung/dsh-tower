import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-commands';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-system-prompt';
import Schema from 'schemastery';

import { registerTowerCommand } from './command.js';
import { isTowerEnabled } from './flag.js';
import { towerWriteGuard } from './guard.js';
import { installNativeSeams } from './native.js';
import { TowerRateLimit } from './rateLimit.js';
import { registerTowerTools } from './tools/index.js';

export const name = 'dsh-tower';
/** tools/commands/subagents required; systemPrompt optional via soft inject. */
export const inject = {
  tools: true,
  commands: true,
  subagents: true,
  systemPrompt: { required: false },
};

export interface Config {
  /** Enable Tower tools (also via DSH_EXPERIMENTAL_TOWER=1). Default false. */
  experimental?: boolean;
  /** Inflight spawn cap (default 8). */
  inflightCap?: number;
  /** Announce Tower in the system prompt when enabled (default true). */
  announceToAgent?: boolean;
}

export const Config: Schema<Config> = Schema.object({
  experimental: Schema.boolean()
    .default(false)
    .description('Enable Tower tools and /tower (also via env DSH_EXPERIMENTAL_TOWER=1).'),
  inflightCap: Schema.number()
    .default(8)
    .description('Max concurrent tower worker/reviewer spawns.'),
  announceToAgent: Schema.boolean()
    .default(true)
    .description('Register a systemPrompt section announcing Tower when experimental is on.'),
});

export function apply(ctx: Context, config: Config = {}): void {
  if (!isTowerEnabled(config)) return;

  const rateLimit = new TowerRateLimit(config.inflightCap ?? 8);
  registerTowerTools(ctx, rateLimit);
  registerTowerCommand(ctx);
  ctx.tools.guard(towerWriteGuard);
  installNativeSeams(ctx, rateLimit, {
    announceToAgent: config.announceToAgent !== false,
  });
}
