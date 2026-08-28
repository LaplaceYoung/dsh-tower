/** First-release rate limit: inflight spawn cap only (no DSH 429 funnel). */
export const DEFAULT_TOWER_INFLIGHT_CAP = 8;

export class TowerRateLimit {
  private inflight = 0;
  /** Child session ids currently holding an inflight slot (filled by spawn / cleared by subagent/end). */
  readonly heldChildren = new Set<string>();
  /** @deprecated use heldChildren — kept for native.ts assignment compat during transition */
  trackHeld?: Set<string>;

  constructor(readonly cap: number = DEFAULT_TOWER_INFLIGHT_CAP) {}

  acquire(): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (this.inflight >= this.cap) {
      return {
        ok: false,
        reason:
          `tower concurrency budget exhausted (${String(this.inflight)}/${String(this.cap)} agents running). ` +
          'Wait for a running agent to complete, then retry.',
      };
    }
    this.inflight += 1;
    return { ok: true };
  }

  /** Record that a spawned child owns the slot acquired above. */
  holdChild(childId: string): void {
    this.heldChildren.add(childId);
    this.trackHeld?.add(childId);
  }

  /** Release one slot if this child still holds it (idempotent). */
  releaseChild(childId: string): void {
    if (!this.heldChildren.delete(childId) && !this.trackHeld?.delete(childId)) return;
    this.trackHeld?.delete(childId);
    this.release();
  }

  release(): void {
    this.inflight = Math.max(0, this.inflight - 1);
  }

  snapshot(): { readonly cap: number; readonly inflight: number } {
    return { cap: this.cap, inflight: this.inflight };
  }

  reset(): void {
    this.inflight = 0;
    this.heldChildren.clear();
    this.trackHeld?.clear();
  }
}
