/**
 * A sliding-window counter.
 *
 * The enforcer uses this to notice when it is in a fight it cannot win: a page
 * that re-asserts its own rate on every `ratechange` would otherwise ping-pong
 * with us forever, burning main-thread time and firing events at the site.
 */

export class SlidingWindow {
  private stamps: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records an event. Returns false once the window is over its limit. */
  record(now: number): boolean {
    this.stamps.push(now);
    this.evict(now);
    return this.stamps.length <= this.limit;
  }

  /** Events still inside the window. */
  count(now: number): number {
    this.evict(now);
    return this.stamps.length;
  }

  /** True while the window is over its limit. */
  isSaturated(now: number): boolean {
    return this.count(now) > this.limit;
  }

  reset(): void {
    this.stamps = [];
  }

  private evict(now: number): void {
    const cutoff = now - this.windowMs;
    const firstLive = this.stamps.findIndex((stamp) => stamp > cutoff);
    this.stamps = firstLive === -1 ? [] : this.stamps.slice(firstLive);
  }
}
