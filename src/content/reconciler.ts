/**
 * The tier-2 safety net: a periodic check for drift the events never reported.
 *
 * It is off by default and turns itself off again. It runs only while the tier
 * calls for it, the page is visible, and something has actually drifted
 * recently — so a well-behaved site, a background tab, and a site that has
 * settled down all cost nothing.
 */

import { needsReconcile, type Tier } from "../core/escalation";

const DEFAULT_INTERVAL_MS = 1_000;
/** Consecutive clean ticks before the net stands down. */
const DEFAULT_CLEAN_TICKS = 5;

export interface ReconcileSource {
  /** Corrects any drift. Returns true when something had drifted. */
  reconcile(): boolean;
}

export type SetTimer = (task: () => void, ms: number) => number;
export type ClearTimer = (id: number) => void;

export interface ReconcilerOptions {
  source: ReconcileSource;
  intervalMs?: number | undefined;
  cleanTicksBeforeStop?: number | undefined;
  setTimer?: SetTimer | undefined;
  clearTimer?: ClearTimer | undefined;
}

export class Reconciler {
  private timerId: number | null = null;
  private cleanTicks = 0;
  private tier: Tier = 0;
  private visible = true;
  private readonly source: ReconcileSource;
  private readonly intervalMs: number;
  private readonly cleanTicksBeforeStop: number;
  private readonly setTimer: SetTimer;
  private readonly clearTimer: ClearTimer;

  constructor(options: ReconcilerOptions) {
    this.source = options.source;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.cleanTicksBeforeStop = options.cleanTicksBeforeStop ?? DEFAULT_CLEAN_TICKS;
    this.setTimer = options.setTimer ?? ((task, ms) => globalThis.setInterval(task, ms) as unknown as number);
    this.clearTimer = options.clearTimer ?? ((id) => globalThis.clearInterval(id));
  }

  /** True while a timer is actually running. */
  get running(): boolean {
    return this.timerId !== null;
  }

  /** Called whenever the enforcement tier moves. */
  setTier(tier: Tier): void {
    this.tier = tier;
    if (needsReconcile(tier)) this.wake();
    else this.stop();
  }

  /** Called when the page is shown or hidden. A hidden tab does no work. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      if (needsReconcile(this.tier)) this.wake();
    } else {
      this.stop();
    }
  }

  /** Restarts the net after it has stood down, when a site misbehaves again. */
  wake(): void {
    this.cleanTicks = 0;
    if (!needsReconcile(this.tier) || !this.visible || this.timerId !== null) return;
    this.timerId = this.setTimer(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timerId === null) return;
    this.clearTimer(this.timerId);
    this.timerId = null;
  }

  private tick(): void {
    if (this.source.reconcile()) {
      this.cleanTicks = 0;
      return;
    }
    this.cleanTicks += 1;
    if (this.cleanTicks >= this.cleanTicksBeforeStop) this.stop();
  }
}
