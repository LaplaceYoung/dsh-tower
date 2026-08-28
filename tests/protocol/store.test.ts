import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { git } from '../../src/protocol/git.js';
import {
  STATE_FILE,
  TOWER_NAME,
  WORKTREES_DIR,
} from '../../src/protocol/paths.js';
import { TowerProtocolError, TowerStore } from '../../src/protocol/store.js';
import { cleanupTemp, commitWorktreeFile, makeTempGitRepo } from './helpers.js';

describe('TowerStore protocol', () => {
  let root = '';
  let store: TowerStore;

  beforeEach(async () => {
    root = await makeTempGitRepo();
    store = new TowerStore(root);
  });

  afterEach(async () => {
    if (root) await cleanupTemp(root);
  });

  it('1. rejects init outside a git repository', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tower-nogit-'));
    const bad = new TowerStore(dir);
    await expect(bad.init('s1')).rejects.toThrow(/git repository/i);
    await cleanupTemp(dir);
  });

  it('2. rejects init on a dirty working tree', async () => {
    await writeFile(join(root, 'WIP.txt'), 'dirty\n', 'utf8');
    await expect(store.init('s1')).rejects.toThrow(/dirty working tree/i);
  });

  it('3. rejects plan with overlapping scopes', async () => {
    await store.init('s1');
    await expect(
      store.plan([
        { title: 'A', scope: ['src/a.ts'] },
        { title: 'B', scope: ['src/'] },
      ]),
    ).rejects.toThrow(/scopes overlap/i);
  });

  it('4. rejects plan with unknown deps', async () => {
    await store.init('s1');
    await expect(
      store.plan([{ title: 'A', scope: ['src/a.ts'], deps: ['M99'] }]),
    ).rejects.toThrow(/unknown mission/i);
  });

  it('5. inbox: private only visible to target; to=all visible to all', async () => {
    await store.init('s1');
    await store.registerAgent({
      name: 'alice',
      agentId: 'agent-alice',
      kind: 'worker',
      missionId: 'M1',
      spawnedAt: new Date().toISOString(),
    });
    await store.registerAgent({
      name: 'bob',
      agentId: 'agent-bob',
      kind: 'worker',
      missionId: 'M2',
      spawnedAt: new Date().toISOString(),
    });

    // Need missions for realism; roster alone is enough for send/read.
    await store.send(TOWER_NAME, {
      to: 'alice',
      subject: 'private ping',
      body: 'only alice',
    });
    await store.send(TOWER_NAME, {
      to: 'all',
      subject: 'broadcast',
      body: 'everyone',
    });

    const alice = await store.readInbox('alice', 20);
    const bob = await store.readInbox('bob', 20);
    const tower = await store.readInbox(TOWER_NAME, 20);

    expect(alice.some((m) => m.subject === 'private ping')).toBe(true);
    expect(alice.some((m) => m.subject === 'broadcast')).toBe(true);
    expect(bob.some((m) => m.subject === 'private ping')).toBe(false);
    expect(bob.some((m) => m.subject === 'broadcast')).toBe(true);
    // Tower sees everything
    expect(tower.some((m) => m.subject === 'private ping')).toBe(true);
    expect(tower.some((m) => m.subject === 'broadcast')).toBe(true);
  });

  it('6. merge rejection matrix: no review → p2 → clean → tip moved → re-review → merge', async () => {
    await store.init('s1');
    const [mission] = await store.plan([
      { title: 'Patch A', scope: ['src/a.ts'], tasks: ['edit a'] },
    ]);
    const wtRel = await store.addWorktree(mission!.worktree, mission!.branch, 'main');
    await store.updateMission(TOWER_NAME, mission!.id, {
      status: 'active',
      owner: 'worker-a',
    });
    await store.registerAgent({
      name: 'worker-a',
      agentId: 'wa',
      kind: 'worker',
      missionId: mission!.id,
      worktree: wtRel,
      branch: mission!.branch,
      spawnedAt: new Date().toISOString(),
    });
    await store.registerAgent({
      name: 'rev-a',
      agentId: 'ra',
      kind: 'reviewer',
      reviewTarget: mission!.branch,
      spawnedAt: new Date().toISOString(),
    });

    await commitWorktreeFile(
      root,
      wtRel,
      'src/a.ts',
      'export const a = 2;\n',
      'feat: bump a',
    );

    // no review
    await expect(store.merge(mission!.branch)).rejects.toThrow(/no review/i);

    // p2 review
    await store.submitReview('rev-a', {
      target: mission!.branch,
      status: 'p2-1items',
      merge: 'fix-then-merge',
      findings: 'nit',
      decision: 'fix first',
    });
    await expect(store.merge(mission!.branch)).rejects.toThrow(/not-clean|clean round/i);

    // clean review
    await store.submitReview('rev-a', {
      target: mission!.branch,
      status: 'clean',
      merge: 'merge',
      findings: 'looks good',
      decision: 'ship',
    });

    // tip moves after clean review
    await commitWorktreeFile(
      root,
      wtRel,
      'src/a.ts',
      'export const a = 3;\n',
      'feat: bump a again',
    );
    await expect(store.merge(mission!.branch)).rejects.toThrow(/moved since|re-review/i);

    // re-review then merge
    await store.submitReview('rev-a', {
      target: mission!.branch,
      status: 'clean',
      merge: 'merge',
      findings: 'still good',
      decision: 'ship',
    });
    const result = await store.merge(mission!.branch);
    expect(result.noop).toBeUndefined();
    expect(result.mergeCommit).toMatch(/^[0-9a-f]{40}$/);

    const tipContent = await git(root, ['show', 'HEAD:src/a.ts']);
    expect(tipContent).toContain('a = 3');
  });

  it('7. rejects merge when deps are unmerged', async () => {
    await store.init('s1');
    const missions = await store.plan([
      { title: 'First', scope: ['src/a.ts'] },
      { title: 'Second', scope: ['src/b.ts'], deps: ['M1'] },
    ]);
    const m2 = missions[1]!;
    const wt = await store.addWorktree(m2.worktree, m2.branch, 'main');
    await store.registerAgent({
      name: 'rev-b',
      agentId: 'rb',
      kind: 'reviewer',
      reviewTarget: m2.branch,
      spawnedAt: new Date().toISOString(),
    });
    await commitWorktreeFile(root, wt, 'src/b.ts', 'export const b = 2;\n', 'feat: b');
    await store.submitReview('rev-b', {
      target: m2.branch,
      status: 'clean',
      merge: 'merge',
      findings: 'ok',
      decision: 'ship',
    });
    await expect(store.merge(m2.branch)).rejects.toThrow(/dependencies not merged/i);
  });

  it('8. rejects merge when files fall outside scope', async () => {
    await store.init('s1');
    const [mission] = await store.plan([{ title: 'Only A', scope: ['src/a.ts'] }]);
    const wt = await store.addWorktree(mission!.worktree, mission!.branch, 'main');
    await store.registerAgent({
      name: 'rev-a',
      agentId: 'ra',
      kind: 'reviewer',
      reviewTarget: mission!.branch,
      spawnedAt: new Date().toISOString(),
    });
    await commitWorktreeFile(root, wt, 'src/a.ts', 'export const a = 9;\n', 'ok');
    await commitWorktreeFile(root, wt, 'src/b.ts', 'export const b = 9;\n', 'oob');
    await store.submitReview('rev-a', {
      target: mission!.branch,
      status: 'clean',
      merge: 'merge',
      findings: 'ok',
      decision: 'ship',
    });
    await expect(store.merge(mission!.branch)).rejects.toThrow(/outside mission|out-of-scope/i);
  });

  it('9. survey mission merge is a noop and does not touch git', async () => {
    await store.init('s1');
    const before = await git(root, ['rev-parse', 'HEAD']);
    const [mission] = await store.plan([
      { title: 'Survey', scope: ['docs/**'], kind: 'survey' },
    ]);
    // create branch tip equal to base (empty worktree branch)
    await store.addWorktree(mission!.worktree, mission!.branch, 'main');
    const result = await store.merge(mission!.branch);
    expect(result.noop).toBe(true);
    const after = await git(root, ['rev-parse', 'HEAD']);
    expect(after).toBe(before);
    const state = await store.load();
    expect(state.missions[0]!.status).toBe('merged');
  });

  it('10. teardown keeps dirty worktrees', async () => {
    await store.init('s1');
    const [mission] = await store.plan([{ title: 'Dirty keep', scope: ['src/a.ts'] }]);
    const wtRel = await store.addWorktree(mission!.worktree, mission!.branch, 'main');
    await writeFile(join(root, wtRel, 'src', 'a.ts'), 'export const a = dirty;\n', 'utf8');
    const report = await store.teardown();
    expect(report.some((line) => line.includes('kept') && line.includes(wtRel))).toBe(true);
    // worktree path still exists
    const { access } = await import('node:fs/promises');
    await expect(access(join(root, wtRel))).resolves.toBeUndefined();
  });

  it('11. second init with new session retires roster, keeps missions', async () => {
    await store.init('session-old');
    const [mission] = await store.plan([{ title: 'Keep me', scope: ['src/a.ts'] }]);
    await store.registerAgent({
      name: 'old-worker',
      agentId: 'ow',
      sessionId: 'session-old',
      kind: 'worker',
      missionId: mission!.id,
      spawnedAt: new Date().toISOString(),
    });

    const result = await store.init('session-new');
    expect(result.created).toBe(false);
    expect(result.retiredAgents).toContain('old-worker');
    expect(result.openMissions).toContain(mission!.id);

    const state = await store.load();
    expect(state.sessionId).toBe('session-new');
    expect(state.roster.agents).toHaveLength(0);
    expect(state.missions).toHaveLength(1);
    expect(state.missions[0]!.id).toBe(mission!.id);

    // state.json is the sole mutable truth under .dsh-tower
    expect(STATE_FILE.startsWith('.dsh-tower/')).toBe(true);
    expect(WORKTREES_DIR).toBe('.dsh-tower/worktrees');
  });
});
