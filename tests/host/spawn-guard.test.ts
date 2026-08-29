import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Context } from '@deepseek-ai/cordis';
import { TowerStore, WORKTREES_DIR } from '../../src/protocol/index.js';
import { refreshRosterCache, towerWriteGuard } from '../../src/host/guard.js';
import { spawnTowerAgent } from '../../src/host/spawn.js';
import { TowerService } from '../../src/host/service.js';
import { cleanupTemp, makeTempGitRepo } from '../protocol/helpers.js';

async function withTowerCtx<T>(
  fn: (ctx: Context) => Promise<T>,
  options: {
    inflightCap?: number;
    startContinuable?: (spec: unknown) => Promise<{ childId: string; messageId: string }>;
  } = {},
): Promise<T> {
  const root = new Context();
  const startContinuable =
    options.startContinuable ??
    (async () => ({ childId: 'unused', messageId: 'm' }));
  root.provide('subagents', { startContinuable });
  let result!: T;
  await root.plugin(async (ctx) => {
    new TowerService(ctx, { inflightCap: options.inflightCap });
    result = await fn(ctx);
  });
  return result;
}

describe('host spawn + write guard', () => {
  let root = '';

  beforeEach(async () => {
    root = await makeTempGitRepo();
  });

  afterEach(async () => {
    if (root) await cleanupTemp(root);
  });

  it('vetoes worker write outside its worktree after roster cache refresh', async () => {
    await withTowerCtx(async (ctx) => {
      const store = new TowerStore(root);
      await store.init('s1');
      const [mission] = await store.plan([{ title: 'A', scope: ['src/a.ts'] }]);
      await store.addWorktree(mission!.worktree, mission!.branch, 'main');
      await store.registerAgent({
        name: 'w1',
        agentId: 'child-1',
        kind: 'worker',
        missionId: mission!.id,
        worktree: mission!.worktree,
        spawnedAt: new Date().toISOString(),
      });
      await refreshRosterCache(ctx, root);

      const agent = {
        id: 'child-1',
        session: {
          id: 'child-1',
          header: { parentSession: 'parent', cwd: root },
        },
      };

      const guard = towerWriteGuard(ctx);
      const denied = guard({
        name: 'write',
        arguments: { file_path: join(root, 'src', 'a.ts') },
        agent: agent as never,
        callId: 'c' as never,
        rootCallId: 'c' as never,
        token: Symbol('t') as never,
        signal: new AbortController().signal,
      });
      expect(denied).toMatch(/only write inside their own worktree/i);

      const allowed = guard({
        name: 'write',
        arguments: {
          file_path: join(root, WORKTREES_DIR, mission!.worktree, 'src', 'a.ts'),
        },
        agent: agent as never,
        callId: 'c' as never,
        rootCallId: 'c' as never,
        token: Symbol('t') as never,
        signal: new AbortController().signal,
      });
      expect(allowed).toBeUndefined();
    });
  });

  it('rolls back worktree when startContinuable fails (no ghost owner)', async () => {
    const startContinuable = vi.fn(async () => {
      throw new Error('boom');
    });

    await withTowerCtx(
      async (ctx) => {
        const store = new TowerStore(root);
        await store.init('s1');
        const [mission] = await store.plan([{ title: 'A', scope: ['src/a.ts'] }]);

        const parent = {
          id: 'parent',
          session: { id: 'parent', header: { cwd: root } },
        };

        await expect(
          spawnTowerAgent({
            ctx,
            parent: parent as never,
            store,
            args: { name: 'w1', kind: 'worker', mission_id: mission!.id },
          }),
        ).rejects.toThrow(/boom|spawn failed/i);

        const state = await store.load();
        expect(state.roster.agents).toHaveLength(0);
        expect(state.missions[0]!.owner).toBeUndefined();

        const { access } = await import('node:fs/promises');
        await expect(
          access(join(root, WORKTREES_DIR, mission!.worktree)),
        ).rejects.toThrow();
      },
      { startContinuable },
    );
  });

  it('registers agent after successful startContinuable', async () => {
    const startContinuable = vi.fn(async () => ({
      childId: 'child-abc',
      messageId: 'msg-1',
    }));

    await withTowerCtx(
      async (ctx) => {
        const store = new TowerStore(root);
        await store.init('s1');
        const [mission] = await store.plan([{ title: 'A', scope: ['src/a.ts'] }]);

        const parent = {
          id: 'parent',
          session: { id: 'parent', header: { cwd: root } },
        };

        ctx.tower.enter('parent');
        const out = await spawnTowerAgent({
          ctx,
          parent: parent as never,
          store,
          args: { name: 'w1', kind: 'worker', mission_id: mission!.id },
        });

        expect(out).toContain('child-abc');
        expect(startContinuable).toHaveBeenCalledOnce();
        const call = startContinuable.mock.calls[0]?.[0] as unknown as {
          request: { toolFilter: { deny: string[] }; prompt: Array<{ text: string }> };
        };
        expect(call.request.toolFilter.deny).toContain('TowerMerge');
        expect(call.request.toolFilter.deny).toContain('AskUserQuestion');
        expect(call.request.prompt[0]!.text).toContain('.dsh-tower/worktrees');

        const state = await store.load();
        expect(state.roster.agents[0]!.agentId).toBe('child-abc');
        expect(state.missions[0]!.owner).toBe('w1');
        expect(state.missions[0]!.status).toBe('active');
      },
      { startContinuable },
    );
  });

  it('reviewer toolFilter also denies write/edit', async () => {
    const startContinuable = vi.fn(async () => ({
      childId: 'rev-1',
      messageId: 'm',
    }));

    await withTowerCtx(
      async (ctx) => {
        const store = new TowerStore(root);
        await store.init('s1');
        await store.plan([{ title: 'A', scope: ['src/a.ts'] }]);

        const parent = {
          id: 'parent',
          session: { id: 'parent', header: { cwd: root } },
        };

        await spawnTowerAgent({
          ctx,
          parent: parent as never,
          store,
          args: { name: 'r1', kind: 'reviewer', review_target: 'feat/a' },
        });
        const deny = (
          startContinuable.mock.calls[0]?.[0] as unknown as {
            request: { toolFilter: { deny: string[] } };
          }
        ).request.toolFilter.deny;
        expect(deny).toEqual(
          expect.arrayContaining(['write', 'edit', 'str_replace_editor', 'AskUserQuestion']),
        );
      },
      { startContinuable },
    );
  });
});
