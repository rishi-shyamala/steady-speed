/**
 * The settings schema, its defaults, and the coercion that stands between stored
 * bytes and the rest of the extension.
 *
 * Nothing downstream ever validates settings again: whatever comes out of
 * `normalizeSettings` is usable, whether it came from storage, an imported file,
 * or an unversioned blob left behind by another speed controller.
 */

import { normalizePattern, parseTarget, type SiteRule } from "./rules";
import { NORMAL_SPEED, conformSpeed, roundSpeed } from "./speed";

export const SETTINGS_VERSION = 1;

/** Finer than this is not worth a keypress; coarser is not a step. */
export const MIN_STEP = 0.05;
export const MAX_STEP = 1;
const MAX_PRESETS = 8;

export interface EnforcementSettings {
  /** Climb the enforcement ladder automatically when a site fights back. */
  autoEscalate: boolean;
  /** Allow the top rung, which injects a script into the page's own world. */
  allowPageWorld: boolean;
}

export interface Settings {
  version: number;
  defaultSpeed: number;
  step: number;
  presets: number[];
  preservePitch: boolean;
  rules: SiteRule[];
  enforcement: EnforcementSettings;
}

export type IdFactory = () => string;

const defaults: Settings = {
  version: SETTINGS_VERSION,
  defaultSpeed: 2,
  step: 0.25,
  presets: [0.5, 1, 1.5, 2, 2.5, 3],
  preservePitch: true,
  rules: [],
  enforcement: { autoEscalate: true, allowPageWorld: true },
};
Object.freeze(defaults.presets);
Object.freeze(defaults.rules);
Object.freeze(defaults.enforcement);

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze(defaults);

export type ParseResult =
  | { ok: true; settings: Settings }
  | { ok: false; error: string };

/** Coerces anything at all into settings that are safe to act on. */
export function normalizeSettings(raw: unknown, makeId: IdFactory = randomId): Settings {
  if (!isPlainObject(raw)) return cloneDefaults();
  const migrated = migrate(raw);

  return {
    version: SETTINGS_VERSION,
    defaultSpeed: conformSpeed(migrated.defaultSpeed, DEFAULT_SETTINGS.defaultSpeed),
    step: normalizeStep(migrated.step),
    presets: normalizePresets(migrated.presets),
    preservePitch:
      typeof migrated.preservePitch === "boolean"
        ? migrated.preservePitch
        : DEFAULT_SETTINGS.preservePitch,
    rules: normalizeRules(migrated.rules, makeId),
    enforcement: normalizeEnforcement(migrated.enforcement),
  };
}

/** Builds a rule from user input, or returns null if the pattern is not usable. */
export function createRule(pattern: string, speed: number, makeId: IdFactory = randomId): SiteRule | null {
  const normalized = normalizePattern(pattern);
  if (normalized === null) return null;
  return { id: makeId(), pattern: normalized, speed: conformSpeed(speed), enabled: true };
}

/** Replaces the rule with the same id, or appends it. Never mutates its input. */
export function upsertRule(settings: Settings, rule: SiteRule): Settings {
  const index = settings.rules.findIndex((existing) => existing.id === rule.id);
  const rules = [...settings.rules];
  if (index === -1) rules.push(rule);
  else rules[index] = rule;
  return { ...settings, rules };
}

/** Drops a rule by id. Never mutates its input. */
export function removeRule(settings: Settings, id: string): Settings {
  return { ...settings, rules: settings.rules.filter((rule) => rule.id !== id) };
}

/**
 * Pins the host of `url` to a speed — the operation behind the popup's
 * "always 1x here" toggle. Reuses the existing rule for that host so repeated
 * use cannot stack duplicates.
 */
export function setSpeedForUrl(
  settings: Settings,
  url: string,
  speed: number,
  makeId: IdFactory = randomId,
): Settings {
  const target = parseTarget(url);
  if (!target || target.host === "") return settings;

  const existing = settings.rules.find((rule) => rule.pattern === target.host);
  if (existing) return upsertRule(settings, { ...existing, speed: conformSpeed(speed), enabled: true });

  // target.host is already canonical, so it needs no re-parsing.
  return upsertRule(settings, {
    id: makeId(),
    pattern: target.host,
    speed: conformSpeed(speed),
    enabled: true,
  });
}

/** Settings as a file the user can keep. */
export function serializeSettings(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** Reads a settings file back, normalising whatever it finds. */
export function parseSettingsJson(text: string, makeId: IdFactory = randomId): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That settings file could not be read as JSON." };
  }
  return { ok: true, settings: normalizeSettings(parsed, makeId) };
}

/* ------------------------------------------------------------------ */
/* migrations                                                          */
/* ------------------------------------------------------------------ */

type RawSettings = Record<string, unknown>;
type Migration = { to: number; run: (raw: RawSettings) => RawSettings };

const MIGRATIONS: readonly Migration[] = [{ to: 1, run: migrateUnversioned }];

function migrate(raw: RawSettings): RawSettings {
  let version = typeof raw.version === "number" && Number.isFinite(raw.version) ? raw.version : 0;
  let current = raw;
  for (const migration of MIGRATIONS) {
    if (version < migration.to) {
      current = migration.run(current);
      version = migration.to;
    }
  }
  return current;
}

/**
 * An object with no version is either a first run or a blob from another speed
 * controller. Both of those store a last-used speed and a blocklist of hosts,
 * which map cleanly onto a default speed and rules pinned at 1x.
 */
function migrateUnversioned(raw: RawSettings): RawSettings {
  const migrated: RawSettings = { ...raw };

  const legacySpeed = raw.lastSpeed ?? raw.speed;
  if (typeof legacySpeed === "number") migrated.defaultSpeed = legacySpeed;

  const legacyBlocklist = raw.blacklist;
  if (Array.isArray(legacyBlocklist)) {
    migrated.rules = legacyBlocklist
      .filter((entry): entry is string => typeof entry === "string")
      .map((pattern) => ({ pattern, speed: NORMAL_SPEED, enabled: true }));
  }

  return migrated;
}

/* ------------------------------------------------------------------ */
/* field coercion                                                      */
/* ------------------------------------------------------------------ */

function normalizeStep(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_SETTINGS.step;
  const rounded = roundSpeed(value);
  if (rounded < MIN_STEP) return MIN_STEP;
  if (rounded > MAX_STEP) return MAX_STEP;
  return rounded;
}

function normalizePresets(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.presets];
  const conformed = value
    .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
    .map((entry) => conformSpeed(entry));
  const unique = [...new Set(conformed)].sort((a, b) => a - b);
  return unique.length === 0 ? [...DEFAULT_SETTINGS.presets] : unique.slice(0, MAX_PRESETS);
}

function normalizeRules(value: unknown, makeId: IdFactory): SiteRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rules: SiteRule[] = [];

  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const pattern = typeof entry.pattern === "string" ? normalizePattern(entry.pattern) : null;
    if (pattern === null) continue;

    const rawId = entry.id;
    const id =
      typeof rawId === "string" && rawId !== "" && !seen.has(rawId) ? rawId : makeId();
    seen.add(id);

    rules.push({
      id,
      pattern,
      speed: conformSpeed(entry.speed, NORMAL_SPEED),
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
    });
  }

  return rules;
}

function normalizeEnforcement(value: unknown): EnforcementSettings {
  if (!isPlainObject(value)) return { ...DEFAULT_SETTINGS.enforcement };
  return {
    autoEscalate:
      typeof value.autoEscalate === "boolean"
        ? value.autoEscalate
        : DEFAULT_SETTINGS.enforcement.autoEscalate,
    allowPageWorld:
      typeof value.allowPageWorld === "boolean"
        ? value.allowPageWorld
        : DEFAULT_SETTINGS.enforcement.allowPageWorld,
  };
}

function cloneDefaults(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    presets: [...DEFAULT_SETTINGS.presets],
    rules: [],
    enforcement: { ...DEFAULT_SETTINGS.enforcement },
  };
}

function isPlainObject(value: unknown): value is RawSettings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}
