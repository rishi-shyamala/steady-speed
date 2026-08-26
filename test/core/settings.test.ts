import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  createRule,
  normalizeSettings,
  parseSettingsJson,
  removeRule,
  serializeSettings,
  setSpeedForUrl,
  upsertRule,
} from "../../src/core/settings";

const ids = () => {
  let n = 0;
  return () => `id${(n += 1)}`;
};

describe("DEFAULT_SETTINGS", () => {
  it("is the answer to the brief: 2x everywhere, nothing pinned", () => {
    expect(DEFAULT_SETTINGS.defaultSpeed).toBe(2);
    expect(DEFAULT_SETTINGS.step).toBe(0.25);
    expect(DEFAULT_SETTINGS.rules).toEqual([]);
    expect(DEFAULT_SETTINGS.version).toBe(SETTINGS_VERSION);
  });

  it("preserves pitch, so speech stays intelligible", () => {
    expect(DEFAULT_SETTINGS.preservePitch).toBe(true);
  });

  it("lets the enforcement ladder escalate on its own", () => {
    expect(DEFAULT_SETTINGS.enforcement).toEqual({ autoEscalate: true, allowPageWorld: true });
  });

  it("is frozen, so nothing can mutate the defaults by accident", () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.rules)).toBe(true);
  });
});

describe("normalizeSettings", () => {
  it("returns the defaults for anything that is not an object", () => {
    for (const input of [undefined, null, 42, "x", [], true]) {
      expect(normalizeSettings(input)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("keeps a valid object unchanged", () => {
    const input = {
      version: 1,
      defaultSpeed: 1.5,
      step: 0.5,
      presets: [1, 2],
      preservePitch: false,
      rules: [{ id: "a", pattern: "example.com", speed: 1, enabled: true }],
      enforcement: { autoEscalate: false, allowPageWorld: false },
    };
    expect(normalizeSettings(input)).toEqual(input);
  });

  it("clamps a stored speed that is out of range", () => {
    expect(normalizeSettings({ version: 1, defaultSpeed: 99 }).defaultSpeed).toBe(4);
    expect(normalizeSettings({ version: 1, defaultSpeed: "fast" }).defaultSpeed).toBe(2);
  });

  it("keeps the step inside a usable range", () => {
    expect(normalizeSettings({ version: 1, step: 0 }).step).toBe(0.25);
    expect(normalizeSettings({ version: 1, step: 5 }).step).toBe(1);
    expect(normalizeSettings({ version: 1, step: 0.001 }).step).toBe(0.05);
    expect(normalizeSettings({ version: 1, step: 0.1 }).step).toBe(0.1);
  });

  it("cleans up presets: conformed, deduped, sorted, capped", () => {
    const settings = normalizeSettings({ version: 1, presets: [3, 99, 1, "x", 1, 0.01] });
    expect(settings.presets).toEqual([0.25, 1, 3, 4]);
  });

  it("falls back to the default presets when none survive", () => {
    expect(normalizeSettings({ version: 1, presets: ["a", null] }).presets).toEqual(
      DEFAULT_SETTINGS.presets,
    );
    expect(normalizeSettings({ version: 1, presets: "nope" }).presets).toEqual(
      DEFAULT_SETTINGS.presets,
    );
  });

  it("drops rules whose pattern cannot be understood", () => {
    const settings = normalizeSettings({
      version: 1,
      rules: [
        { id: "a", pattern: "ex*ample.com", speed: 1, enabled: true },
        { id: "b", pattern: "example.com", speed: 1, enabled: true },
        { id: "c", pattern: 42 },
        "not a rule",
        null,
      ],
    });
    expect(settings.rules.map((r) => r.pattern)).toEqual(["example.com"]);
  });

  it("canonicalises rule patterns as it loads them", () => {
    const settings = normalizeSettings({
      version: 1,
      rules: [{ id: "a", pattern: "  WWW.Example.COM/Watch/ ", speed: 1, enabled: true }],
    });
    expect(settings.rules[0]?.pattern).toBe("www.example.com/Watch");
  });

  it("repairs rules with missing or invalid fields", () => {
    const settings = normalizeSettings({
      version: 1,
      rules: [{ pattern: "example.com" }],
    });
    expect(settings.rules[0]).toMatchObject({ speed: 1, enabled: true });
    expect(typeof settings.rules[0]?.id).toBe("string");
    expect(settings.rules[0]?.id).not.toBe("");
  });

  it("replaces an empty rule id", () => {
    const settings = normalizeSettings({
      version: 1,
      rules: [{ id: "", pattern: "example.com", speed: 1, enabled: true }],
    });
    expect(settings.rules[0]?.id).not.toBe("");
  });

  it("gives duplicate rule ids fresh ones, so edits target one rule", () => {
    const settings = normalizeSettings({
      version: 1,
      rules: [
        { id: "same", pattern: "a.test", speed: 1, enabled: true },
        { id: "same", pattern: "b.test", speed: 1, enabled: true },
      ],
    });
    expect(settings.rules[0]?.id).not.toBe(settings.rules[1]?.id);
  });

  it("drops keys it does not know about", () => {
    const settings = normalizeSettings({ version: 1, evil: "payload" });
    expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it("repairs a partial enforcement object", () => {
    expect(normalizeSettings({ version: 1, enforcement: { autoEscalate: false } }).enforcement).toEqual(
      { autoEscalate: false, allowPageWorld: true },
    );
    expect(
      normalizeSettings({ version: 1, enforcement: { allowPageWorld: false } }).enforcement,
    ).toEqual({ autoEscalate: true, allowPageWorld: false });
    expect(normalizeSettings({ version: 1, enforcement: "no" }).enforcement).toEqual(
      DEFAULT_SETTINGS.enforcement,
    );
  });

  it("degrades gracefully if it meets settings from a future version", () => {
    const settings = normalizeSettings({ version: 99, defaultSpeed: 3, somethingNew: true });
    expect(settings.defaultSpeed).toBe(3);
    expect(settings.version).toBe(SETTINGS_VERSION);
  });
});

describe("migration from an unversioned blob", () => {
  it("reads a speed from the shapes other controllers store", () => {
    expect(normalizeSettings({ lastSpeed: 1.5 }).defaultSpeed).toBe(1.5);
    expect(normalizeSettings({ speed: 3 }).defaultSpeed).toBe(3);
  });

  it("turns a blocklist of hostnames into rules pinned at 1x", () => {
    const settings = normalizeSettings({ blacklist: ["meet.google.com", "  ", "ex*ample"] });
    expect(settings.rules).toHaveLength(1);
    expect(settings.rules[0]).toMatchObject({ pattern: "meet.google.com", speed: 1, enabled: true });
  });

  it("leaves versioned settings alone", () => {
    expect(normalizeSettings({ version: 1, lastSpeed: 3 }).defaultSpeed).toBe(2);
  });
});

describe("createRule", () => {
  it("canonicalises the pattern and conforms the speed", () => {
    expect(createRule("  Example.COM/  ", 99, ids())).toEqual({
      id: "id1",
      pattern: "example.com",
      speed: 4,
      enabled: true,
    });
  });

  it("returns null for a pattern that cannot be understood", () => {
    expect(createRule("ex*ample", 1, ids())).toBeNull();
  });
});

describe("upsertRule / removeRule", () => {
  const base = normalizeSettings({
    version: 1,
    rules: [{ id: "a", pattern: "example.com", speed: 1, enabled: true }],
  });

  it("replaces a rule with the same id, in place", () => {
    const next = upsertRule(base, { id: "a", pattern: "example.com", speed: 3, enabled: true });
    expect(next.rules).toHaveLength(1);
    expect(next.rules[0]?.speed).toBe(3);
  });

  it("appends a rule with a new id", () => {
    const next = upsertRule(base, { id: "b", pattern: "other.test", speed: 3, enabled: true });
    expect(next.rules.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the settings it was given", () => {
    upsertRule(base, { id: "b", pattern: "other.test", speed: 3, enabled: true });
    expect(base.rules).toHaveLength(1);
  });

  it("removes by id and ignores an id that is not there", () => {
    expect(removeRule(base, "a").rules).toEqual([]);
    expect(removeRule(base, "zzz").rules).toHaveLength(1);
  });
});

describe("setSpeedForUrl", () => {
  const base = normalizeSettings({ version: 1, defaultSpeed: 2 });

  it("pins the current site at a speed, which is what the 1x toggle does", () => {
    const next = setSpeedForUrl(base, "https://music.youtube.com/watch?v=1", 1, ids());
    expect(next.rules).toEqual([
      { id: "id1", pattern: "music.youtube.com", speed: 1, enabled: true },
    ]);
  });

  it("updates the existing rule for that host rather than stacking another", () => {
    const once = setSpeedForUrl(base, "https://example.com/a", 1, ids());
    const twice = setSpeedForUrl(once, "https://example.com/b", 3, ids());
    expect(twice.rules).toHaveLength(1);
    expect(twice.rules[0]?.speed).toBe(3);
  });

  it("leaves settings untouched for a URL with no host", () => {
    expect(setSpeedForUrl(base, "about:blank", 1, ids())).toBe(base);
    expect(setSpeedForUrl(base, "not a url", 1, ids())).toBe(base);
  });
});

describe("export and import", () => {
  it("round-trips through JSON", () => {
    const settings = normalizeSettings({
      version: 1,
      defaultSpeed: 3,
      rules: [{ id: "a", pattern: "example.com", speed: 1, enabled: true }],
    });
    const parsed = parseSettingsJson(serializeSettings(settings));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.settings).toEqual(settings);
  });

  it("reports unreadable JSON instead of throwing", () => {
    const parsed = parseSettingsJson("{not json");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/could not be read/i);
  });

  it("normalises anything it does parse, so a hand-edited file is still safe", () => {
    const parsed = parseSettingsJson('{"version":1,"defaultSpeed":99}');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.settings.defaultSpeed).toBe(4);
  });
});
