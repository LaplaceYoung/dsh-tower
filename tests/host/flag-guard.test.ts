import { describe, expect, it } from 'vitest';

import { isTowerEnabled } from '../../src/host/flag.js';
import { TowerRateLimit } from '../../src/host/rateLimit.js';
import { towerWriteGuard } from '../../src/host/guard.js';
import { workerBriefing } from '../../src/host/briefing.js';
import { TOWER_ALL_TOOLS } from '../../src/host/runtime.js';

describe('host flag / rate limit / guard helpers', () => {
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

  it('write guard fails open without roster cache', () => {
    const reason = towerWriteGuard({
      name: 'write',
      arguments: { file_path: '/tmp/x.ts' },
      callId: 'c' as never,
      rootCallId: 'c' as never,
      token: Symbol('t') as never,
      signal: AbortSignal.abort(),
    });
    expect(reason).toBeUndefined();
  });

  it('worker briefing pins absolute worktree path', () => {
    const text = workerBriefing({
      name: 'w1',
      kind: 'worker',
      repoRoot: '/repo',
      worktreeAbs: '/repo/.dsh-tower/worktrees/wt-1',
      missionId: 'M1',
      missionTitle: 'A',
      branch: 'feat/a',
      scope: ['src/a.ts'],
    });
    expect(text).toContain('/repo/.dsh-tower/worktrees/wt-1');
    expect(text).toContain('Never call TowerInit');
  });

  it('exports all 11 tower tool names', () => {
    expect(TOWER_ALL_TOOLS).toHaveLength(11);
  });
});
