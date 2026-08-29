import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-tools';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';

import { TOWER_NAME } from '../../protocol/index.js';
import { refreshRosterCache } from '../guard.js';
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

export function registerTowerTools(ctx: Context): void {
  ctx.tools.register(
    textTool(
      'TowerInit',
      'Initialize `.dsh-tower/` protocol state in the current git repository (main agent only). Refuses dirty working trees.',
      {},
      async (_args, exec) =>
        runTower(async () => {
          requireMain(exec);
          const store = storeFromExec(exec);
          const sessionId =
            exec.agent !== undefined ? String(exec.agent.session.id) : undefined;
          const result = await store.init(sessionId);
          if (sessionId !== undefined) ctx.tower.enter(sessionId);
          await refreshRosterCache(ctx, store.repoRoot);
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
            additionalProperties: false,
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
        review_target: { type: 'string', description: 'Required for reviewer (branch name)' },
        instructions: { type: 'string', description: 'Optional extra briefing' },
      },
      async (args, exec) =>
        runTower(async () => {
          requireMain(exec);
          if (exec.agent === undefined) throw new Error('TowerSpawn requires a calling agent');
          const store = storeFromExec(exec);
          const kind = String(args['kind']);
          if (kind !== 'worker' && kind !== 'reviewer') {
            throw new Error('kind must be worker | reviewer');
          }
          return spawnTowerAgent({
            ctx,
            parent: exec.agent,
            store,
            args: {
              name: String(args['name']),
              kind,
              mission_id: args['mission_id'] as string | undefined,
              review_target: args['review_target'] as string | undefined,
              instructions: args['instructions'] as string | undefined,
            },
            signal: exec.signal,
          });
        }),
    ),
  );

  ctx.tools.register(
    textTool(
      'TowerSend',
      'Send an inbox message to tower, all, or a roster agent.',
      {
        to: { type: 'string', required: true },
        subject: { type: 'string', required: true },
        body: { type: 'string', required: true },
        scope: { type: 'string' },
        action: { type: 'string' },
        consent_ref: { type: 'string' },
      },
      async (args, exec) =>
        runTower(async () => {
          const store = storeFromExec(exec);
          const state = await store.load();
          const caller = store.resolveCallerName(state, protocolAgentId(exec.agent));
          const rel = await store.send(caller, {
            to: String(args['to']),
            subject: String(args['subject']),
            body: String(args['body']),
            scope: args['scope'] as string | undefined,
            action: args['action'] as string | undefined,
            consentRef: args['consent_ref'] as string | undefined,
          });
          return `sent: ${rel}`;
        }),
    ),
  );

  ctx.tools.register(
    textTool(
      'TowerInbox',
      'Read recent inbox messages visible to the caller.',
      {
        limit: { type: 'number', description: 'Max messages (default 20)' },
      },
      async (args, exec) =>
        runTower(async () => {
          const store = storeFromExec(exec);
          const state = await store.load();
          const caller = store.resolveCallerName(state, protocolAgentId(exec.agent));
          const items = await store.readInbox(caller, Number(args['limit'] ?? 20));
          if (items.length === 0) return '(inbox empty)';
          return items
            .map(
              (m) =>
                `### ${m.subject}\nfrom: ${m.from} → ${m.to}\nat: ${m.sentAt}\nfile: ${m.file}\n\n${m.body}`,
            )
            .join('\n\n---\n\n');
        }),
    ),
  );

  ctx.tools.register(
    textTool(
      'TowerFinding',
      'File an out-of-scope finding for the tower to triage.',
      {
        type: { type: 'string', required: true, description: 'bug | improve | vuln | idea' },
        title: { type: 'string', required: true },
        summary: { type: 'string', required: true },
        details: { type: 'string', required: true },
        suggested_fix: { type: 'string', required: true },
        severity: { type: 'string' },
        location: { type: 'string' },
      },
      async (args, exec) =>
        runTower(async () => {
          const store = storeFromExec(exec);
          const state = await store.load();
          const caller = store.resolveCallerName(state, protocolAgentId(exec.agent));
          const rel = await store.fileFinding(caller, {
            type: args['type'] as 'bug' | 'improve' | 'vuln' | 'idea',
            title: String(args['title']),
            summary: String(args['summary']),
            details: String(args['details']),
            suggestedFix: String(args['suggested_fix']),
            severity: args['severity'] as 'low' | 'medium' | 'high' | 'critical' | undefined,
            location: args['location'] as string | undefined,
          });
          return `filed: ${rel}`;
        }),
    ),
  );

  ctx.tools.register(
    textTool(
      'TowerReview',
      'Submit a review for a mission branch (reviewers / tower).',
      {
        target: { type: 'string', required: true, description: 'Branch name' },
        status: {
          type: 'string',
          required: true,
          description: 'clean | p1-Nitems | p2-Nitems',
        },
        merge: {
          type: 'string',
          required: true,
          description: 'merge | fix-then-merge | hold',
        },
        findings: { type: 'string', required: true },
        decision: { type: 'string', required: true },
        checks: { type: 'array', items: { type: 'string' } },
      },
      async (args, exec) =>
        runTower(async () => {
          const store = storeFromExec(exec);
          const state = await store.load();
          const caller = store.resolveCallerName(state, protocolAgentId(exec.agent));
          const rel = await store.submitReview(caller, {
            target: String(args['target']),
            status: String(args['status']),
            merge: String(args['merge']),
            findings: String(args['findings']),
            decision: String(args['decision']),
            checks: args['checks'] as string[] | undefined,
          });
          return `review written: ${rel}`;
        }),
    ),
  );

  ctx.tools.register(
    textTool(
      'TowerMission',
      'Update a mission status/note/blocker/task/owner/scope (workers: own mission only).',
      {
        id: { type: 'string', required: true },
        status: { type: 'string' },
        note: { type: 'string' },
        blocker: { type: 'string' },
        clear_blockers: { type: 'boolean' },
        task_done: { type: 'string' },
        owner: { type: 'string' },
        scope: { type: 'array', items: { type: 'string' } },
      },
      async (args, exec) =>
        runTower(async () => {
          const store = storeFromExec(exec);
          const state = await store.load();
          const caller = store.resolveCallerName(state, protocolAgentId(exec.agent));
          const mission = await store.updateMission(caller, String(args['id']), {
            status: args['status'] as never,
            note: args['note'] as string | undefined,
            blocker: args['blocker'] as string | undefined,
            clearBlockers: args['clear_blockers'] as boolean | undefined,
            taskDone: args['task_done'] as string | undefined,
            owner: args['owner'] as string | undefined,
            scope: args['scope'] as string[] | undefined,
          });
          return `mission ${mission.id} status=${mission.status} owner=${mission.owner ?? '—'}`;
        }),
    ),
  );

  ctx.tools.register(
    textTool(
      'TowerMerge',
      'Merge a mission branch onto the recorded base after hard gates pass (main agent only).',
      {
        branch: { type: 'string', required: true },
      },
      async (args, exec) =>
        runTower(async () => {
          requireMain(exec);
          const store = storeFromExec(exec);
          const result = await store.merge(String(args['branch']));
          const lines = [
            result.noop === true
              ? `survey merge noop — marked merged (base tip ${result.mergeCommit.slice(0, 7)})`
              : `merged ${String(args['branch'])} → ${result.mergeCommit.slice(0, 7)}`,
          ];
          if (result.conflictsWith.length > 0) {
            lines.push('branches now overlapping files:');
            for (const c of result.conflictsWith) {
              lines.push(`- ${c.branch}: ${c.files.join(', ')}`);
            }
          }
          return lines.join('\n');
        }),
    ),
  );

  ctx.tools.register(
    textTool(
      'TowerStatus',
      'Summarize tower missions, roster, and recent activity.',
      {
        log_lines: { type: 'number', description: 'Activity log lines (default 20)' },
      },
      async (args, exec) =>
        runTower(async () => {
          const store = storeFromExec(exec);
          const state = await store.load();
          // Presence check — any roster participant or main may call.
          store.resolveCallerName(state, protocolAgentId(exec.agent));
          const log = await store.recentLog(Number(args['log_lines'] ?? 20));
          const rl = ctx.tower.rateLimit.snapshot();
          const missionRows = state.missions.map(
            (m) =>
              `| ${m.id} | ${m.title} | ${m.status} | ${m.owner ?? '—'} | ${m.branch} | ${m.worktree} |`,
          );
          const rosterRows = state.roster.agents.map(
            (a) => `| ${a.name} | ${a.kind} | ${a.agentId} | ${a.missionId ?? a.reviewTarget ?? '—'} |`,
          );
          return [
            `# Tower status`,
            `base: ${state.base}  session: ${state.sessionId ?? '—'}`,
            `rate-limit: ${rl.inflight}/${rl.budget} (cap ${rl.cap})`,
            '',
            '## Missions',
            '| ID | Title | Status | Owner | Branch | Worktree |',
            '| -- | ----- | ------ | ----- | ------ | -------- |',
            ...(missionRows.length > 0 ? missionRows : ['| — | — | — | — | — | — |']),
            '',
            '## Roster',
            '| Name | Kind | Agent | Mission/Target |',
            '| ---- | ---- | ----- | -------------- |',
            ...(rosterRows.length > 0 ? rosterRows : ['| — | — | — | — |']),
            '',
            '## Recent activity',
            ...(log.length > 0 ? log : ['(empty)']),
          ].join('\n');
        }),
    ),
  );

  ctx.tools.register(
    textTool(
      'TowerTeardown',
      'Remove tower worktrees (keeps dirty ones unless force). Main agent only.',
      {
        force: { type: 'boolean', description: 'Force-remove dirty worktrees' },
      },
      async (args, exec) =>
        runTower(async () => {
          requireMain(exec);
          const store = storeFromExec(exec);
          const report = await store.teardown({ force: Boolean(args['force']) });
          if (exec.agent !== undefined) ctx.tower.exit(String(exec.agent.session.id));
          ctx.tower.clearRosterCache(store.repoRoot);
          return ['teardown:', ...report.map((line) => `- ${line}`)].join('\n');
        }),
    ),
  );

  void TOWER_NAME;
}
