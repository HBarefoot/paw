export class RateLimiter {
  private windows: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxRequestsPerMinute: number) {
    this.maxRequests = maxRequestsPerMinute;
    this.windowMs = 60_000;

    // Periodic cleanup every 5 minutes to evict stale entries
    this.cleanupTimer = setInterval(() => this.evictStale(), 5 * 60_000);
  }

  check(key: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(key) ?? [];
    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= this.maxRequests) {
      const oldestInWindow = timestamps[0];
      const retryAfterMs = oldestInWindow + this.windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);
    return { allowed: true };
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  resetAll(): void {
    this.windows.clear();
  }

  /** Remove entries with no recent timestamps */
  private evictStale(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.windows) {
      const active = timestamps.filter((t) => t > cutoff);
      if (active.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, active);
      }
    }
  }

  /** Clean up the periodic timer (call on shutdown) */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
