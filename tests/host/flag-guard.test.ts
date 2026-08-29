import { describe, expect, it } from 'vitest';

import { isTowerEnabled } from '../../src/host/flag.js';
import { TowerRateLimit } from '../../src/host/rateLimit.js';
import { workerBriefing } from '../../src/host/briefing.js';
import { TOWER_ALL_TOOLS } from '../../src/host/runtime.js';
import { reviewerToolDeny, workerToolDeny, TOWER_MODE_MAIN_DENY } from '../../src/host/profiles.js';
import {
  TOWER_MODE_EXIT_REMINDER,
  TOWER_MODE_FULL_REMINDER,
  TOWER_MODE_SPARSE_REMINDER,
} from '../../src/host/injection/index.js';

describe('host flag / rate limit / profiles / injection', () => {
  it('defaults experimental tower to off', () => {
    const prev = process.env['DSH_EXPERIMENTAL_TOWER'];
    delete process.env['DSH_EXPERIMENTAL_TOWER'];
    expect(isTowerEnabled({})).toBe(false);
    expect(isTowerEnabled({ experimental: false })).toBe(false);
    expect(isTowerEnabled({ experimental: true })).toBe(true);
    process.env['DSH_EXPERIMENTAL_TOWER'] = '1';
    expect(isTowerEnabled({})).toBe(true);
    if (prev === undefined) delete process.env['DSH_EXPERIMENTAL_TOWER'];
    else process.env['DSH_EXPERIMENTAL_TOWER'] = prev;
  });

  it('rate limit caps inflight spawns', () => {
    const rl = new TowerRateLimit(2);
    expect(rl.acquire().ok).toBe(true);
    expect(rl.acquire().ok).toBe(true);
    const third = rl.acquire();
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.reason).toMatch(/exhausted/i);
    rl.release();
    expect(rl.acquire().ok).toBe(true);
  });

  it('rate limit pause after reportRateLimited', () => {
    const rl = new TowerRateLimit(8);
    expect(rl.acquire().ok).toBe(true);
    rl.reportRateLimited();
    const next = rl.acquire();
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.reason).toMatch(/paused|rate-limit/i);
    rl.release();
    rl.reportSuccess();
    expect(rl.acquire().ok).toBe(true);
  });

  it('exposes eleven tower tools', () => {
    expect(TOWER_ALL_TOOLS).toHaveLength(11);
  });

  it('worker deny includes AskUserQuestion and TodoList; reviewer also denies writes', () => {
    expect(workerToolDeny()).toEqual(
      expect.arrayContaining(['AskUserQuestion', 'TodoList', 'TowerMerge']),
    );
    expect(reviewerToolDeny()).toEqual(
      expect.arrayContaining(['write', 'edit', 'str_replace_editor', 'AskUserQuestion']),
    );
    expect(TOWER_MODE_MAIN_DENY.has('TodoList')).toBe(true);
  });

  it('injection texts use .dsh-tower and cover full/sparse/exit', () => {
    expect(TOWER_MODE_FULL_REMINDER).toMatch(/\.dsh-tower/);
    expect(TOWER_MODE_SPARSE_REMINDER).toMatch(/\.dsh-tower/);
    expect(TOWER_MODE_EXIT_REMINDER).toMatch(/\.dsh-tower/);
    expect(TOWER_MODE_EXIT_REMINDER).toMatch(/\/tower on/);
  });

  it('worker briefing mentions protocol tools', () => {
    const text = workerBriefing({
      name: 'w1',
      kind: 'worker',
      repoRoot: '/repo',
      worktreeAbs: '/repo/.dsh-tower/worktrees/wt-1',
      missionId: 'm1',
      missionTitle: 'A',
      branch: 'feat/a',
      scope: ['src/a.ts'],
    });
    expect(text).toMatch(/TowerSend/);
    expect(text).toMatch(/\.dsh-tower/);
  });
});
