import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-tools';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';

import { TOWER_NAME } from '../../protocol/index.js';
import { refreshRosterCache } from '../guard.js';
import type { TowerRateLimit } from '../rateLimit.js';
import {
  TOWER_MAIN_AGENT_ONLY,
  protocolAgentId,
  runTower,
  storeFromExec,
} from '../runtime.js';
import { spawnTowerAgent } from '../spawn.js';

function textTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  execute: (args: Record<string, unknown>, exec: ToolRunContext) => Promise<string>,
) {
  return defineTool({
    name,
    description,
    parameters: parameters as never,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      return execute(args as Record<string, unknown>, exec);
    },
  });
}

function requireMain(exec: ToolRunContext): void {
  if (protocolAgentId(exec.agent) !== 'main') {
    throw new Error(TOWER_MAIN_AGENT_ONLY);
  }
}

export function registerTowerTools(ctx: Context, rateLimit: TowerRateLimit): void {
  ctx.tools.register(
    textTool(
      'TowerInit',
      'Initialize `.dsh-tower/` protocol state in the current git repository (main agent only). Refuses dirty working trees.',
      {},
      async (_args, exec) =>
        runTower(async () => {
          requireMain(exec);
          const store = storeFromExec(exec);
          const result = await store.init(
            exec.agent !== undefined ? String(exec.agent.session.id) : undefined,
          );
          await refreshRosterCache(store.repoRoot);
          return [
            result.created
              ? 'tower workspace initialized'
              : 'tower workspace already initialized — existing state preserved',
            `base branch: ${result.base}`,
            'workspace: .dsh-tower/ (comms under .dsh-tower/comms/, worktrees under .dsh-tower/worktrees/)',
            ...(result.openMissions.length > 0
              ? [
                  `carried-over open missions: ${result.openMissions.join(', ')} — continue or abandon before planning over their scopes`,
                ]
              : []),
            ...(result.retiredAgents.length > 0
              ? [`retired prior-session roster: ${result.retiredAgents.join(', ')}`]
              : []),
          ].join('\n');
        }),
    ),
  );

  ctx.tools.register(
    textTool(
      'TowerPlan',
      'Plan one or more tower missions with disjoint scopes (main agent only).',
      {
        missions: {
          type: 'array',
          required: true,
          description: 'Missions to plan',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', required: true },
              scope: {
                type: 'array',
                required: true,
                items: { type: 'string' },
                description: 'picomatch globs; must be disjoint across open build missions',
              },
              tasks: { type: 'array', items: { type: 'string' } },
              deps: { type: 'array', items: { type: 'string' } },
              kind: { type: 'string', description: 'build | survey' },
            },
          },
        },
      },
      async (args, exec) =>
        runTower(async () => {
          requireMain(exec);
          const store = storeFromExec(exec);
          const missions = await store.plan(
            (args['missions'] as Array<Record<string, unknown>>).map((m) => ({
              title: String(m['title']),
              scope: (m['scope'] as string[]) ?? [],
              tasks: m['tasks'] as string[] | undefined,
              deps: m['deps'] as string[] | undefined,
              kind: m['kind'] as 'build' | 'survey' | undefined,
            })),
          );
          const rows = missions.map(
            (m) =>
              `| ${m.id} | ${m.title} | ${m.kind} | ${m.branch} | ${m.worktree} | ${m.scope.join(', ')} |`,
          );
          return [
            `planned ${String(missions.length)} mission(s):`,
            '',
            '| ID | Mission | Kind | Branch | Worktree | Scope |',
            '| -- | ------- | ---- | ------ | -------- | ----- |',
            ...rows,
            '',
            'Next: TowerSpawn one worker per mission (dependency-unblocked ones immediately).',
          ].join('\n');
        }),
    ),
  );

  ctx.tools.register(
    textTool(
      'TowerSpawn',
      'Spawn a continuable tower worker or reviewer via ctx.subagents.startContinuable (main agent only).',
      {
        name: { type: 'string', required: true, description: 'Roster name (unique)' },
        kind: { type: 'string', required: true, description: 'worker | reviewer' },
        mission_id: { type: 'string', description: 'Required for worker' },
