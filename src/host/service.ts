import { Service, type Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';

import {
  reminderFor,
  type TowerModeDisclosure,
} from './injection/index.js';
import { DEFAULT_TOWER_INFLIGHT_CAP, TowerRateLimit } from './rateLimit.js';
import type { Config } from './config.js';

declare module '@deepseek-ai/cordis' {
  interface Context {
    tower: TowerService;
  }
}

interface ModeState {
  active: boolean;
  lastDisclosure?: TowerModeDisclosure;
}

export interface RosterCacheEntry {
  readonly repoRoot: string;
  readonly agents: ReadonlyArray<{ readonly agentId: string; readonly worktree?: string }>;
  readonly loadedAt: number;
}

/**
 * Cordis-native Tower host service (`ctx.tower`).
 * Owns mode latch, rate limit, roster cache — fiber-disposed via Service + effect.
 */
export class TowerService extends Service {
  readonly rateLimit: TowerRateLimit;
  readonly announceToAgent: boolean;
  private readonly modes = new Map<string, ModeState>();
  private readonly rosterCache = new Map<string, RosterCacheEntry>();

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'tower');
    this.rateLimit = new TowerRateLimit(config.inflightCap ?? DEFAULT_TOWER_INFLIGHT_CAP);
    this.announceToAgent = config.announceToAgent !== false;
    ctx.effect(
      () => () => {
        this.modes.clear();
        this.rosterCache.clear();
        this.rateLimit.reset();
      },
      'tower.runtimeCleanup()',
    );
  }

  isActive(sessionId: string | undefined): boolean {
    if (sessionId === undefined) return false;
    return this.modes.get(sessionId)?.active === true;
  }

  /** Enter tower mode for a session (idempotent). */
  enter(sessionId: string): void {
    const cur = this.modes.get(sessionId);
    if (cur?.active === true) return;
    this.modes.set(sessionId, { active: true, lastDisclosure: cur?.lastDisclosure });
  }

  /** Exit tower mode (idempotent). */
  exit(sessionId: string): void {
    const cur = this.modes.get(sessionId);
    if (cur === undefined || !cur.active) return;
    this.modes.set(sessionId, { active: false, lastDisclosure: cur.lastDisclosure });
  }

  getRosterCache(repoRoot: string): RosterCacheEntry | undefined {
    return this.rosterCache.get(repoRoot);
  }

  setRosterCache(entry: RosterCacheEntry): void {
    this.rosterCache.set(entry.repoRoot, entry);
  }

  clearRosterCache(repoRoot?: string): void {
    if (repoRoot === undefined) this.rosterCache.clear();
    else this.rosterCache.delete(repoRoot);
  }

  /**
   * Inject a mode reminder via agent.steer (DSH analogue of Kimi reminder provider).
   * Returns false when steer/llm is unavailable.
   */
  async inject(
    agent: Agent,
    disclosure: TowerModeDisclosure,
    extra = '',
  ): Promise<{ ok: boolean; text: string }> {
    const sessionId = String(agent.session.id);
    const body = `${reminderFor(disclosure)}${extra}`;
    const mode = this.modes.get(sessionId) ?? { active: disclosure !== 'exit' };
    mode.lastDisclosure = disclosure;
    this.modes.set(sessionId, mode);

    try {
      const { createUserMessage } = await import('@deepseek-ai/dsh-llm');
      agent.steer(
        createUserMessage({
          content: [{ type: 'text', text: body }],
          source: { kind: 'user' },
        }),
      );
      return { ok: true, text: body };
    } catch {
      return { ok: false, text: body };
    }
  }

  /** Sparse wake injection after a child ends (deduped if last was already sparse). */
  async maybeSparseOnWake(agent: Agent | undefined): Promise<void> {
    if (agent === undefined) return;
    const sessionId = String(agent.session.id);
    if (!this.isActive(sessionId)) return;
    const last = this.modes.get(sessionId)?.lastDisclosure;
    if (last === 'sparse') return;
    await this.inject(agent, 'sparse');
  }
}
