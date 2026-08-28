/** First-release rate limit: inflight spawn cap only (no DSH 429 funnel). */
export const DEFAULT_TOWER_INFLIGHT_CAP = 8;

export class TowerRateLimit {
  private inflight = 0;

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

  release(): void {
    this.inflight = Math.max(0, this.inflight - 1);
  }

  snapshot(): { readonly cap: number; readonly inflight: number } {
    return { cap: this.cap, inflight: this.inflight };
  }

  reset(): void {
    this.inflight = 0;
  }
}
