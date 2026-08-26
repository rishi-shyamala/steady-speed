/**
 * Every message that crosses between the background page, the popup, and a
 * frame's content script. Small and closed on purpose: anything not listed here
 * is ignored rather than acted on.
 */

import type { Tier } from "../core/escalation";

export const COMMANDS = ["speed-up", "speed-down", "toggle-normal", "reset-default"] as const;
export type CommandName = (typeof COMMANDS)[number];

export type ContentRequest =
  | { type: "command"; command: CommandName }
  | { type: "set-speed"; speed: number }
  | { type: "get-state" };

/** What a frame reports about itself, for the popup and the toolbar badge. */
export interface ContentState {
  url: string;
  /** What the media is actually being set to. */
  speed: number;
  /** What the rules and default alone would give. */
  ruleSpeed: number;
  /** Set when this tab has been nudged away from the rule speed. */
  override: number | null;
  tier: Tier;
  mediaCount: number;
}

export type BackgroundRequest = { type: "speed-changed"; speed: number };

export function isCommandName(value: unknown): value is CommandName {
  return typeof value === "string" && (COMMANDS as readonly string[]).includes(value);
}

export function parseContentRequest(message: unknown): ContentRequest | null {
  if (typeof message !== "object" || message === null) return null;
  const record = message as Record<string, unknown>;

  if (record.type === "get-state") return { type: "get-state" };
  if (record.type === "command" && isCommandName(record.command)) {
    return { type: "command", command: record.command };
  }
  if (record.type === "set-speed" && typeof record.speed === "number") {
    return { type: "set-speed", speed: record.speed };
  }
  return null;
}

export function parseBackgroundRequest(message: unknown): BackgroundRequest | null {
  if (typeof message !== "object" || message === null) return null;
  const record = message as Record<string, unknown>;
  if (record.type === "speed-changed" && typeof record.speed === "number") {
    return { type: "speed-changed", speed: record.speed };
  }
  return null;
}
