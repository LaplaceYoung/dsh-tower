import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-commands';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-system-prompt';

import { Config } from './config.js';
import { registerTowerCommand } from './command.js';
import { isTowerEnabled } from './flag.js';
import { towerWriteGuard } from './guard.js';
import { installNativeSeams } from './native.js';
import { TowerService } from './service.js';
import { registerTowerTools } from './tools/index.js';

export { Config } from './config.js';
export { TowerService } from './service.js';

export const name = 'dsh-tower';
/** tools/commands/subagents required; systemPrompt optional via soft inject. */
export const inject = {
  tools: true,
  commands: true,
  subagents: true,
  systemPrompt: { required: false },
};

/**
 * Mount Tower when experimental (config or DSH_EXPERIMENTAL_TOWER) is on.
 * Provides `ctx.tower` (mode, rate limit, roster cache) and registers tools/command/seams.
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (!isTowerEnabled(config)) return;

  new TowerService(ctx, config);
  registerTowerTools(ctx);
  registerTowerCommand(ctx);
  ctx.tools.guard(towerWriteGuard(ctx));
  installNativeSeams(ctx);
}
