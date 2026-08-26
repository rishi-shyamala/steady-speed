/**
 * What the popup shows, worked out as a plain value before anything is drawn.
 * Keeping this separate is what lets the popup's behaviour be tested without
 * asserting on markup.
 */

import type { Tier } from "../core/escalation";
import { findMatchingRule, parseTarget, type SiteRule } from "../core/rules";
import type { Settings } from "../core/settings";
import { NORMAL_SPEED, speedsEqual } from "../core/speed";
import type { ContentState } from "../platform/messages";

export interface PopupModel {
  /** True when no content script answered — an internal page, or a PDF viewer. */
  unavailable: boolean;
  /** The page's own URL, empty when nothing answered. */
  url: string;
  host: string;
  speed: number;
  /** What the rules and default alone would give, ignoring any override. */
  ruleSpeed: number;
  overridden: boolean;
  defaultSpeed: number;
  step: number;
  presets: number[];
  /** The rule that governs this page, if any. */
  rule: SiteRule | null;
  /** True when this site is pinned to normal speed. */
  pinnedAtNormal: boolean;
  tier: Tier;
  mediaCount: number;
}

export function buildPopupModel(state: ContentState | null, settings: Settings): PopupModel {
  const base = {
    defaultSpeed: settings.defaultSpeed,
    step: settings.step,
    presets: settings.presets,
  };

  if (!state) {
    return {
      ...base,
      unavailable: true,
      url: "",
      host: "",
      speed: settings.defaultSpeed,
      ruleSpeed: settings.defaultSpeed,
      overridden: false,
      rule: null,
      pinnedAtNormal: false,
      tier: 0,
      mediaCount: 0,
    };
  }

  const rule = findMatchingRule(state.url, settings.rules);
  return {
    ...base,
    unavailable: false,
    url: state.url,
    host: parseTarget(state.url)?.host ?? "",
    speed: state.speed,
    ruleSpeed: state.ruleSpeed,
    overridden: state.override !== null,
    rule,
    pinnedAtNormal: rule !== null && speedsEqual(rule.speed, NORMAL_SPEED),
    tier: state.tier,
    mediaCount: state.mediaCount,
  };
}

/** One line describing how hard the extension is currently having to work. */
export function describeTier(tier: Tier): string {
  switch (tier) {
    case 0:
      return "Nothing to fight here.";
    case 1:
      return "Re-applying when this site resets the speed.";
    case 2:
      return "Also checking periodically — this site resets quietly.";
    default:
      return "Holding the speed from inside the page — this site fights hard.";
  }
}
