/**
 * Speed arithmetic.
 *
 * Playback rates are held to two decimal places throughout. Stepping is done in
 * integer hundredths so that walking the range up and down repeatedly cannot
 * accumulate float error and leave you at 1.9999999999x.
 */

/** Below this Firefox stops producing audible audio. */
export const MIN_SPEED = 0.25;
/** Above this Firefox stops producing audible audio. */
export const MAX_SPEED = 4;
/** Unmodified playback. */
export const NORMAL_SPEED = 1;
/** Used when a caller supplies no usable step. */
export const DEFAULT_STEP = 0.25;

/** Half of the last place we keep, so two speeds that round alike compare alike. */
const TOLERANCE = 0.005;

/** Rounds to the two decimal places every speed in this extension is held to. */
export function roundSpeed(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** Constrains a speed to the range the browser can actually play with sound. */
export function clampSpeed(value: number): number {
  if (value < MIN_SPEED) return MIN_SPEED;
  if (value > MAX_SPEED) return MAX_SPEED;
  return value;
}

/**
 * Turns anything — a stored value, a parsed input, a page's own `playbackRate` —
 * into a speed that is safe to apply.
 */
export function conformSpeed(value: unknown, fallback: number = NORMAL_SPEED): number {
  if (isUsableNumber(value)) return clampSpeed(roundSpeed(value));
  if (isUsableNumber(fallback)) return clampSpeed(roundSpeed(fallback));
  return NORMAL_SPEED;
}

/**
 * Moves to the neighbouring value on the step grid, so a speed that drifted off
 * the grid snaps back onto it rather than carrying its offset forever.
 */
export function stepSpeed(current: number, step: number, direction: 1 | -1): number {
  const stepHundredths = toHundredths(usableStep(step));
  const currentHundredths = toHundredths(conformSpeed(current));
  const units = currentHundredths / stepHundredths;
  const nextUnits = direction === 1 ? Math.floor(units + EPSILON) + 1 : Math.ceil(units - EPSILON) - 1;
  return clampSpeed(roundSpeed((nextUnits * stepHundredths) / 100));
}

/** True when two speeds would render and apply identically. */
export function speedsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < TOLERANCE;
}

/** Human-facing speed, e.g. `1.25x`. */
export function formatSpeed(speed: number): string {
  return `${roundSpeed(speed)}x`;
}

/**
 * Toolbar badge text. Empty at normal speed so the toolbar stays quiet when
 * nothing is being changed, and never longer than the four characters a badge
 * can show.
 */
export function formatBadge(speed: number): string {
  if (speedsEqual(speed, NORMAL_SPEED)) return "";
  const text = String(roundSpeed(speed));
  return text.startsWith("0.") ? text.slice(1) : text;
}

/** Guards against float comparisons at exact grid boundaries. */
const EPSILON = 1e-9;

function isUsableNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function usableStep(step: number): number {
  if (!isUsableNumber(step) || step <= 0) return DEFAULT_STEP;
  const rounded = roundSpeed(step);
  return rounded < 0.01 ? DEFAULT_STEP : rounded;
}

function toHundredths(value: number): number {
  return Math.round(value * 100);
}
