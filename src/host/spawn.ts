import { join } from 'node:path';

import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Context } from '@deepseek-ai/cordis';
import type { ContinuableStart } from '@deepseek-ai/dsh-subagent';

import {
  TOWER_NAME,
  WORKTREES_DIR,
  worktreeRemove,
  type TowerMission,
  type TowerStore,
} from '../protocol/index.js';
import { workerBriefing } from './briefing.js';
import { refreshRosterCache } from './guard.js';
import { reviewerToolDeny, workerToolDeny } from './profiles.js';

const SUBAGENT_PROVIDER = 'spawn';

export interface SpawnArgs {
  readonly name: string;
  readonly kind: 'worker' | 'reviewer';
  readonly mission_id?: string;
  readonly review_target?: string;
  readonly instructions?: string;
}

export async function spawnTowerAgent(input: {
  readonly ctx: Context;
  readonly parent: Agent;
  readonly store: TowerStore;
  readonly args: SpawnArgs;
  readonly signal?: AbortSignal;
}): Promise<string> {
  const { ctx, parent, store, args } = input;
  const rateLimit = ctx.tower.rateLimit;
  const state = await store.load();

  if (store.findByName(state, args.name) !== undefined) {
    throw new Error(
      `tower agent "${args.name}" is already registered — resume it instead of spawning a duplicate`,
    );
  }

  let mission: TowerMission | undefined;
  let reviewTarget: string | undefined;
  let worktreeRel: string | undefined;

  if (args.kind === 'worker') {
    if (args.mission_id === undefined) {
      throw new Error('worker spawns require mission_id');
    }
    mission = state.missions.find((m) => m.id === args.mission_id);
    if (mission === undefined) {
      throw new Error(`unknown mission "${args.mission_id}"`);
    }
    if (mission.owner !== undefined) {
      throw new Error(
        `mission ${mission.id} already has owner "${mission.owner}" — do not spawn a second worker`,
      );
    }
  } else {
    reviewTarget = args.review_target;
    if (reviewTarget === undefined) {
      throw new Error('reviewer spawns require review_target');
    }
  }

  const gate = rateLimit.acquire();
  if (!gate.ok) throw new Error(gate.reason);

  let slotHeld = true;
  let worktreeCreated = false;

  try {
    if (mission !== undefined) {
      worktreeRel = await store.addWorktree(mission.worktree, mission.branch, state.base);
      worktreeCreated = true;
    }

    const worktreeAbs =
      mission !== undefined
        ? store.abs(join(WORKTREES_DIR, mission.worktree))
        : undefined;

    const prompt = workerBriefing({
      name: args.name,
      kind: args.kind,
      repoRoot: store.repoRoot,
      worktreeAbs,
      missionId: mission?.id,
      missionTitle: mission?.title,
      branch: mission?.branch,
      scope: mission?.scope,
      reviewTarget,
      extra: args.instructions,
    });

    const deny = args.kind === 'reviewer' ? reviewerToolDeny() : workerToolDeny();

    let started: ContinuableStart;
    try {
      started = await ctx.subagents.startContinuable({
        provider: SUBAGENT_PROVIDER,
        label:
          mission !== undefined
            ? `tower worker ${args.name}: ${mission.title}`
            : `tower reviewer ${args.name}: ${reviewTarget ?? ''}`,
        request: {
          prompt: [{ type: 'text', text: prompt }],
          parent,
          toolFilter: { deny: [...deny] },
        },
        signal: input.signal ?? AbortSignal.timeout(120_000),
      });
    } catch (error) {
      if (worktreeCreated && mission !== undefined) {
        try {
          await worktreeRemove(store.repoRoot, store.abs(join(WORKTREES_DIR, mission.worktree)));
        } catch {
          // best-effort rollback
        }
      }
      throw new Error(
        `tower spawn failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const agentId = String(started.childId);
    await store.registerAgent({
      name: args.name,
      agentId,
      sessionId: String(parent.session.id),
      kind: args.kind,
      missionId: mission?.id,
      reviewTarget,
      worktree: mission?.worktree,
      branch: mission?.branch,
      spawnedAt: new Date().toISOString(),
    });

    if (mission !== undefined) {
      await store.updateMission(
        TOWER_NAME,
        mission.id,
        { status: 'active', owner: args.name },
        { silent: true },
      );
    }

    await store.appendLog(TOWER_NAME, 'spawn', {
      name: args.name,
      kind: args.kind,
      agent: agentId,
      mission: mission?.id,
      target: reviewTarget,
    });

    await refreshRosterCache(ctx, store.repoRoot);
    rateLimit.holdChild(agentId);
    slotHeld = false;

    // Sparse reminder on parent when a child settles is handled at wake time;
    // after spawn acceptance, refresh full coordination context once if mode active.
    if (ctx.tower.isActive(String(parent.session.id))) {
      void ctx.tower.inject(parent, 'sparse');
    }

    return [
      `name: ${args.name}`,
      `kind: ${args.kind}`,
      `agent_id: ${agentId}`,
      'status: running (continuable)',
      ...(mission !== undefined
        ? [
            `mission: ${mission.id} — ${mission.title}`,
            `branch: ${mission.branch}`,
            `worktree: ${worktreeAbs}`,
          ]
        : [`review_target: ${reviewTarget ?? ''}`]),
      '',
      `The ${args.kind} continues in the background after inbox acceptance. Track with TowerStatus / TowerInbox.`,
    ].join('\n');
  } finally {
    if (slotHeld) rateLimit.release();
  }
}
