/**
 * How hard to fight a site that keeps resetting the playback rate.
 *
 * The tier is evidence-driven rather than configured: a page that never touches
 * the rate stays at tier 0 and costs nothing, and a page that fights gets met
 * with exactly as much machinery as it forces. Every transition is a pure
 * function of the previous state, so the whole ladder is testable without a DOM.
 *
 *   0  passive     apply on discovery and on media events
 *   1  reactive    also re-apply when the site changes the rate under us
 *   2  reconcile   also run a self-disabling periodic check
 *   3  page world  also intercept the playbackRate setter in the page's world
 */

export const TIER_PASSIVE = 0;
export const TIER_REACTIVE = 1;
export const TIER_RECONCILE = 2;
export const TIER_PAGE_WORLD = 3;

export type Tier = 0 | 1 | 2 | 3;

export interface EscalationConfig {
  /** When false the tier never moves on its own. */
  autoEscalate: boolean;
  /** When false the ladder stops below page-world interception. */
  allowPageWorld: boolean;
  /** Divergences inside the window needed to climb above tier 1. */
  climbThreshold: number;
  windowMs: number;
  /** Quiet time before dropping back one tier. */
  calmMs: number;
}

export const DEFAULT_ESCALATION_CONFIG: Readonly<EscalationConfig> = Object.freeze({
  autoEscalate: true,
  allowPageWorld: true,
  climbThreshold: 3,
  windowMs: 5_000,
  calmMs: 30_000,
});

export interface EscalationState {
  readonly tier: Tier;
  /** Timestamps of unexplained rate changes still inside the window. */
  readonly divergences: readonly number[];
  /** When the site last surprised us, or when the tier last moved. */
  readonly quietSince: number;
}

export function createEscalationState(tier: Tier = TIER_PASSIVE, now = 0): EscalationState {
  return { tier, divergences: [], quietSince: now };
}

/** The highest tier this configuration permits. */
export function ceilingTier(config: EscalationConfig): Tier {
  return config.allowPageWorld ? TIER_PAGE_WORLD : TIER_RECONCILE;
}

/**
 * Records a rate change we did not make. The first one proves tier 0 is not
 * enough and climbs immediately; climbing further needs repeated evidence.
 */
export function recordDivergence(
  state: EscalationState,
  now: number,
  config: EscalationConfig,
): EscalationState {
  const divergences = [...state.divergences.filter((at) => at > now - config.windowMs), now];
  const unchanged: EscalationState = { tier: state.tier, divergences, quietSince: now };

  if (!config.autoEscalate) return unchanged;
  if (state.tier >= ceilingTier(config)) return unchanged;
  if (state.tier === TIER_PASSIVE) return climb(state.tier, now);
  if (divergences.length >= config.climbThreshold) return climb(state.tier, now);
  return unchanged;
}

/** Drops a tier once the site has left us alone for long enough. */
export function recordCalm(
  state: EscalationState,
  now: number,
  config: EscalationConfig,
): EscalationState {
  if (state.tier === TIER_PASSIVE) return state;
  if (now - state.quietSince < config.calmMs) return state;
  return { tier: (state.tier - 1) as Tier, divergences: [], quietSince: now };
}

/** Tier 1 and up re-apply the rate when the site changes it. */
export function shouldReapply(tier: Tier): boolean {
  return tier >= TIER_REACTIVE;
}

/** Tier 2 and up run the periodic reconcile. */
export function needsReconcile(tier: Tier): boolean {
  return tier >= TIER_RECONCILE;
}

/** Tier 3 injects into the page's own world. */
export function needsPageWorld(tier: Tier): boolean {
  return tier >= TIER_PAGE_WORLD;
}

function climb(tier: Tier, now: number): EscalationState {
  return { tier: (tier + 1) as Tier, divergences: [], quietSince: now };
}
