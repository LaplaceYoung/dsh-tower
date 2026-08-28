import { describe, expect, it, vi } from 'vitest';

import { TowerRateLimit } from '../../src/host/rateLimit.js';
import { TOWER_PROMPT_GUIDANCE, installNativeSeams } from '../../src/host/native.js';

describe('native DSH seams', () => {
  it('announces tower in system prompt guidance text', () => {
    expect(TOWER_PROMPT_GUIDANCE).toMatch(/dsh-tower/);
    expect(TOWER_PROMPT_GUIDANCE).toMatch(/TowerInit/);
    expect(TOWER_PROMPT_GUIDANCE).toMatch(/\/tower/);
  });

  it('registers systemPrompt, pre-execute, and subagent/end listeners', () => {
    const section = vi.fn();
    const on = vi.fn();
    const rateLimit = new TowerRateLimit(2);
    const ctx = {
      systemPrompt: { section },
      on,
      tools: { guard: vi.fn() },
    };

    installNativeSeams(ctx as never, rateLimit, { announceToAgent: true });

    expect(section).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'plugin:dsh-tower', order: 260 }),
    );
    const events = on.mock.calls.map((c) => c[0]);
    expect(events).toContain('tools/pre-execute');
    expect(events).toContain('subagent/end');
  });

  it('subagent/end releases a held child slot', () => {
    const listeners = new Map<string, Function>();
    const rateLimit = new TowerRateLimit(2);
    const ctx = {
      on: (event: string, fn: Function) => {
        listeners.set(event, fn);
      },
    };
    installNativeSeams(ctx as never, rateLimit, { announceToAgent: false });

    expect(rateLimit.acquire().ok).toBe(true);
    rateLimit.holdChild('child-1');
    expect(rateLimit.snapshot().inflight).toBe(1);

    listeners.get('subagent/end')!({ id: 'child-1' });
    expect(rateLimit.snapshot().inflight).toBe(0);

    // idempotent
    listeners.get('subagent/end')!({ id: 'child-1' });
    expect(rateLimit.snapshot().inflight).toBe(0);
  });
});
