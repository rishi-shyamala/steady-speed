import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../../src/core/settings";
import { buildPopupModel, describeTier } from "../../src/popup/model";
import type { ContentState } from "../../src/platform/messages";

const settings = (overrides: Record<string, unknown> = {}) =>
  normalizeSettings({ version: 1, defaultSpeed: 2, ...overrides });

const state = (overrides: Partial<ContentState> = {}): ContentState => ({
  url: "https://example.com/watch",
  speed: 2,
  ruleSpeed: 2,
  override: null,
  tier: 0,
  mediaCount: 1,
  ...overrides,
});

describe("when no content script answered", () => {
  it("says so, and still offers the default speed", () => {
    const model = buildPopupModel(null, settings());
    expect(model.unavailable).toBe(true);
    expect(model.speed).toBe(2);
    expect(model.host).toBe("");
    expect(model.rule).toBeNull();
  });
});

describe("an ordinary page", () => {
  it("shows the host and what the media is doing", () => {
    const model = buildPopupModel(state(), settings());
    expect(model).toMatchObject({
      unavailable: false,
      host: "example.com",
      speed: 2,
      ruleSpeed: 2,
      overridden: false,
      mediaCount: 1,
    });
  });

  it("marks a speed that only applies to this tab", () => {
    const model = buildPopupModel(state({ speed: 3, override: 3 }), settings());
    expect(model.overridden).toBe(true);
    expect(model.ruleSpeed).toBe(2);
  });
});

describe("a page with no readable URL", () => {
  it("has no host to show", () => {
    expect(buildPopupModel(state({ url: "about:blank" }), settings()).host).toBe("");
    expect(buildPopupModel(state({ url: "not a url" }), settings()).host).toBe("");
  });
});

describe("pinned sites", () => {
  it("finds the rule governing this page", () => {
    const model = buildPopupModel(
      state({ speed: 1, ruleSpeed: 1 }),
      settings({ rules: [{ id: "a", pattern: "example.com", speed: 1, enabled: true }] }),
    );
    expect(model.rule?.id).toBe("a");
    expect(model.pinnedAtNormal).toBe(true);
  });

  it("does not call a pin at another speed a normal-speed pin", () => {
    const model = buildPopupModel(
      state({ speed: 3, ruleSpeed: 3 }),
      settings({ rules: [{ id: "a", pattern: "example.com", speed: 3, enabled: true }] }),
    );
    expect(model.pinnedAtNormal).toBe(false);
  });

  it("ignores a rule for a different site", () => {
    const model = buildPopupModel(
      state(),
      settings({ rules: [{ id: "a", pattern: "other.test", speed: 1, enabled: true }] }),
    );
    expect(model.rule).toBeNull();
  });
});

describe("describeTier", () => {
  it("says something true and specific for every rung", () => {
    const lines = [0, 1, 2, 3].map((tier) => describeTier(tier as 0 | 1 | 2 | 3));
    expect(new Set(lines).size).toBe(4);
    expect(lines[0]).toMatch(/nothing/i);
    expect(lines[3]).toMatch(/inside the page/i);
  });
});
