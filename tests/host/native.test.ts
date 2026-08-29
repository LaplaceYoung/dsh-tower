import { describe, expect, it, vi } from 'vitest';

import { Context } from '@deepseek-ai/cordis';
import { TowerService } from '../../src/host/service.js';
import { TOWER_PROMPT_GUIDANCE, installNativeSeams } from '../../src/host/native.js';

describe('native DSH seams + TowerService', () => {
  it('announces tower in system prompt guidance text', () => {
    expect(TOWER_PROMPT_GUIDANCE).toMatch(/dsh-tower/);
    expect(TOWER_PROMPT_GUIDANCE).toMatch(/TowerInit/);
    expect(TOWER_PROMPT_GUIDANCE).toMatch(/\/tower/);
    expect(TOWER_PROMPT_GUIDANCE).toMatch(/off/);
  });

  it('registers systemPrompt, pre-execute, and subagent/end via ctx.tower', async () => {
    const section = vi.fn(() => () => {});
    const root = new Context();
    root.provide('tools', { register: () => () => {}, guard: () => () => {} });
    root.provide('commands', { register: () => () => {} });
    root.provide('subagents', { startContinuable: async () => ({}) });
    root.provide('systemPrompt', { section });

    const events: string[] = [];
    await root.plugin((ctx) => {
      new TowerService(ctx, { announceToAgent: true, inflightCap: 2 });
      const origOn = ctx.on.bind(ctx);
      ctx.on = ((event: string, ...rest: unknown[]) => {
        events.push(event);
        return (origOn as (...a: unknown[]) => unknown)(event, ...rest);
      }) as typeof ctx.on;
      installNativeSeams(ctx);
    });

    expect(section).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'plugin:dsh-tower', order: 260 }),
    );
    expect(events).toContain('tools/pre-execute');
    expect(events).toContain('subagent/end');
  });

  it('subagent/end releases a held child slot via ctx.tower.rateLimit', async () => {
    const root = new Context();
    root.provide('tools', { register: () => () => {}, guard: () => () => {} });

    await root.plugin((ctx) => {
      new TowerService(ctx, { announceToAgent: false, inflightCap: 2 });
      let endHandler: ((info: { id: string }) => void) | undefined;
      const origOn = ctx.on.bind(ctx);
      ctx.on = ((event: string, fn: (...a: unknown[]) => unknown) => {
        if (event === 'subagent/end') endHandler = fn as (info: { id: string }) => void;
        return (origOn as (...a: unknown[]) => unknown)(event, fn);
      }) as typeof ctx.on;
      installNativeSeams(ctx);

      expect(ctx.tower.rateLimit.acquire().ok).toBe(true);
      ctx.tower.rateLimit.holdChild('child-1');
      expect(ctx.tower.rateLimit.snapshot().inflight).toBe(1);

      endHandler!({ id: 'child-1' });
      expect(ctx.tower.rateLimit.snapshot().inflight).toBe(0);

      endHandler!({ id: 'child-1' });
      expect(ctx.tower.rateLimit.snapshot().inflight).toBe(0);
    });
  });

  it('enter / exit / isActive mode latch', async () => {
    const root = new Context();
    await root.plugin((ctx) => {
      new TowerService(ctx, {});
      expect(ctx.tower.isActive('s1')).toBe(false);
      ctx.tower.enter('s1');
      expect(ctx.tower.isActive('s1')).toBe(true);
      ctx.tower.enter('s1');
      expect(ctx.tower.isActive('s1')).toBe(true);
      ctx.tower.exit('s1');
      expect(ctx.tower.isActive('s1')).toBe(false);
    });
  });
});
