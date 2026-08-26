/**
 * Applying the target speed, and deciding how hard to insist.
 *
 * Writes are conditional: nothing is assigned unless it differs from the target,
 * so re-applying on every media event costs a comparison rather than an event
 * storm. Divergences — rate changes we did not make — drive the escalation
 * ladder, and a per-element sliding window stops a site that re-asserts its own
 * rate from dragging us into a ping-pong loop.
 */

import {
  DEFAULT_ESCALATION_CONFIG,
  type EscalationConfig,
  type EscalationState,
  type Tier,
  createEscalationState,
  recordCalm,
  recordDivergence,
  shouldReapply,
} from "../core/escalation";
import { SlidingWindow } from "../core/rate-limit";
import { speedsEqual } from "../core/speed";
import type { MediaRegistry } from "./registry";

/** Re-applies inside the window before we assume we are in a losing fight. */
const DEFAULT_REAPPLY_LIMIT = 6;
const DEFAULT_REAPPLY_WINDOW_MS = 1_000;
const DEFAULT_COOLDOWN_MS = 2_000;

export interface EnforcementTarget {
  speed: number;
  preservePitch: boolean;
}

export interface EnforcerOptions {
  registry: MediaRegistry;
  /** Read afresh each time, so a settings change takes effect immediately. */
  getTarget: () => EnforcementTarget;
  config?: EscalationConfig | undefined;
  initialTier?: Tier | undefined;
  now?: (() => number) | undefined;
  onTierChange?: ((tier: Tier) => void) | undefined;
  reapplyLimit?: number | undefined;
  reapplyWindowMs?: number | undefined;
  cooldownMs?: number | undefined;
}

interface LoopGuard {
  window: SlidingWindow;
  cooldownUntil: number;
}

export class Enforcer {
  private state: EscalationState;
  private readonly guards = new WeakMap<HTMLMediaElement, LoopGuard>();
  private readonly registry: MediaRegistry;
  private readonly getTarget: () => EnforcementTarget;
  private readonly config: EscalationConfig;
  private readonly now: () => number;
  private readonly onTierChange: (tier: Tier) => void;
  private readonly reapplyLimit: number;
  private readonly reapplyWindowMs: number;
  private readonly cooldownMs: number;

  constructor(options: EnforcerOptions) {
    this.registry = options.registry;
    this.getTarget = options.getTarget;
    this.config = options.config ?? DEFAULT_ESCALATION_CONFIG;
    this.now = options.now ?? (() => Date.now());
    this.onTierChange = options.onTierChange ?? (() => {});
    this.reapplyLimit = options.reapplyLimit ?? DEFAULT_REAPPLY_LIMIT;
    this.reapplyWindowMs = options.reapplyWindowMs ?? DEFAULT_REAPPLY_WINDOW_MS;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.state = createEscalationState(options.initialTier ?? 0, this.now());
  }

  get tier(): Tier {
    return this.state.tier;
  }

  /** Restores a tier learned on an earlier visit to this site. */
  setTier(tier: Tier): void {
    if (tier === this.state.tier) return;
    this.state = createEscalationState(tier, this.now());
    this.onTierChange(tier);
  }

  /** Brings one element to the target, writing only what differs. */
  apply(media: HTMLMediaElement): void {
    const { speed, preservePitch } = this.getTarget();
    if (!speedsEqual(media.playbackRate, speed)) media.playbackRate = speed;
    if (typeof media.defaultPlaybackRate === "number" && !speedsEqual(media.defaultPlaybackRate, speed)) {
      media.defaultPlaybackRate = speed;
    }
    if (typeof media.preservesPitch === "boolean" && media.preservesPitch !== preservePitch) {
      media.preservesPitch = preservePitch;
    }
  }

  applyAll(): void {
    this.registry.forEachMedia((media) => this.apply(media));
  }

  /** Routes a media event from the shared discovery listeners. */
  handleEvent(media: HTMLMediaElement, type: string): void {
    if (type === "ratechange") this.handleRateChange(media);
    else this.apply(media);
  }

  /**
   * The tier-2 safety net. Reports whether anything had drifted, so the caller
   * can stop ticking once the page settles.
   */
  reconcile(): boolean {
    const now = this.now();
    let diverged = false;

    this.registry.forEachMedia((media) => {
      if (this.isAtTarget(media)) return;
      diverged = true;
      this.apply(media);
    });

    this.transition(diverged ? recordDivergence(this.state, now, this.config) : recordCalm(this.state, now, this.config));
    return diverged;
  }

  private handleRateChange(media: HTMLMediaElement): void {
    if (this.isAtTarget(media)) return;

    const now = this.now();
    this.transition(recordDivergence(this.state, now, this.config));
    if (!shouldReapply(this.state.tier)) return;

    const guard = this.guardFor(media);
    if (now < guard.cooldownUntil) return;
    if (!guard.window.record(now)) {
      // We are losing a ping-pong with the page. Back off rather than burn the
      // main thread; the tier-2 reconcile will pick it up on a slower cadence.
      guard.cooldownUntil = now + this.cooldownMs;
      guard.window.reset();
      return;
    }
    this.apply(media);
  }

  private isAtTarget(media: HTMLMediaElement): boolean {
    return speedsEqual(media.playbackRate, this.getTarget().speed);
  }

  private transition(next: EscalationState): void {
    const previous = this.state.tier;
    this.state = next;
    if (next.tier !== previous) this.onTierChange(next.tier);
  }

  private guardFor(media: HTMLMediaElement): LoopGuard {
    let guard = this.guards.get(media);
    if (!guard) {
      guard = { window: new SlidingWindow(this.reapplyLimit, this.reapplyWindowMs), cooldownUntil: 0 };
      this.guards.set(media, guard);
    }
    return guard;
  }
}
