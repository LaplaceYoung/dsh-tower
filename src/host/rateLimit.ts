/** Inflight spawn governor (Kimi TowerRateLimitService shape, DSH-adapted). */
export const DEFAULT_TOWER_INFLIGHT_CAP = 8;
export const TOWER_MAX_BUDGET = 16;

export interface TowerRateLimitSnapshot {
  readonly cap: number;
  readonly inflight: number;
  readonly budget: number;
  readonly blockedUntil: number | null;
}

export class TowerRateLimit {
  private inflight = 0;
  private capacity = Number.POSITIVE_INFINITY;
  private blockedUntil: number | null = null;
  /** Child session ids currently holding an inflight slot. */
  readonly heldChildren = new Set<string>();

  constructor(readonly cap: number = DEFAULT_TOWER_INFLIGHT_CAP) {}

  budget(): number {
    const soft = Number.isFinite(this.capacity)
      ? Math.min(this.cap, this.capacity)
      : this.cap;
    return Math.max(1, Math.min(TOWER_MAX_BUDGET, soft));
  }

  acquire(): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    const now = Date.now();
    if (this.blockedUntil !== null && now < this.blockedUntil) {
      const waitSec = Math.ceil((this.blockedUntil - now) / 1000);
      return {
        ok: false,
        reason: `tower spawn paused after rate-limit (~${String(waitSec)}s remaining). Retry shortly.`,
      };
    }
    const budget = this.budget();
    if (this.inflight >= budget) {
      return {
        ok: false,
        reason:
          `tower concurrency budget exhausted (${String(this.inflight)}/${String(budget)} agents running). ` +
          'Wait for a running agent to complete, then retry.',
      };
    }
    this.inflight += 1;
    return { ok: true };
  }

  /** Record that a spawned child owns the slot acquired above. */
  holdChild(childId: string): void {
    this.heldChildren.add(childId);
  }

  /** Release one slot if this child still holds it (idempotent). */
  releaseChild(childId: string): void {
    if (!this.heldChildren.delete(childId)) return;
    this.release();
  }

  release(): void {
    this.inflight = Math.max(0, this.inflight - 1);
  }

  /** Adaptive shrink hook (wired when a 429 funnel exists). */
  reportRateLimited(): void {
    if (this.inflight > 0) {
      this.capacity = Math.max(1, this.inflight - 1);
    }
    this.blockedUntil = Date.now() + 60_000;
  }

  reportSuccess(): void {
    this.blockedUntil = null;
  }

  snapshot(): TowerRateLimitSnapshot {
    return {
      cap: this.cap,
      inflight: this.inflight,
      budget: this.budget(),
      blockedUntil: this.blockedUntil,
    };
  }

  reset(): void {
    this.inflight = 0;
    this.capacity = Number.POSITIVE_INFINITY;
    this.blockedUntil = null;
    this.heldChildren.clear();
  }
}
