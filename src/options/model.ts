/**
 * The parts of the settings page that are worth testing without a DOM: turning
 * what the user typed into values the settings schema will accept.
 */

import { conformSpeed, formatSpeed, roundSpeed } from "../core/speed";

/** Presets are edited as one comma-separated line, which is fewer controls. */
export function formatPresets(presets: readonly number[]): string {
  return presets.map((preset) => roundSpeed(preset)).join(", ");
}

/**
 * Reads that line back. Returns null when nothing usable was typed, so the
 * caller can leave the stored presets alone rather than wiping them.
 */
export function parsePresets(text: string): number[] | null {
  const values = text
    .split(/[,\s]+/)
    .filter((part) => part !== "")
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .map((value) => conformSpeed(value));

  const unique = [...new Set(values)].sort((a, b) => a - b);
  return unique.length === 0 ? null : unique;
}

/** A learned tier as one readable line for the settings page. */
export function describeLearnedTier(host: string, tier: number): string {
  const effort =
    tier >= 3 ? "holds the speed from inside the page" : tier === 2 ? "checks periodically" : "re-applies on change";
  return `${host} — ${effort}`;
}

/** The label on a rule's speed, used in the rule list. */
export function ruleSpeedLabel(speed: number): string {
  return formatSpeed(conformSpeed(speed));
}
