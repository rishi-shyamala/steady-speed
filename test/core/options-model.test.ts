import { describe, expect, it } from "vitest";
import { describeLearnedTier, formatPresets, parsePresets, ruleSpeedLabel } from "../../src/options/model";

describe("formatPresets", () => {
  it("writes the line the user edits", () => {
    expect(formatPresets([0.5, 1, 1.5, 2])).toBe("0.5, 1, 1.5, 2");
  });
});

describe("parsePresets", () => {
  it("reads a comma separated line", () => {
    expect(parsePresets("1, 1.5, 2")).toEqual([1, 1.5, 2]);
  });

  it("accepts spaces instead of commas", () => {
    expect(parsePresets("1 1.5 2")).toEqual([1, 1.5, 2]);
  });

  it("sorts, dedupes and clamps", () => {
    expect(parsePresets("3, 99, 1, 3, 0.01")).toEqual([0.25, 1, 3, 4]);
  });

  it("leaves the stored presets alone when nothing usable was typed", () => {
    expect(parsePresets("")).toBeNull();
    expect(parsePresets("   ")).toBeNull();
    expect(parsePresets("fast, faster")).toBeNull();
  });
});

describe("describeLearnedTier", () => {
  it("says what each site turned out to need", () => {
    expect(describeLearnedTier("a.test", 1)).toMatch(/re-applies/);
    expect(describeLearnedTier("b.test", 2)).toMatch(/periodically/);
    expect(describeLearnedTier("c.test", 3)).toMatch(/inside the page/);
    expect(describeLearnedTier("c.test", 3)).toContain("c.test");
  });
});

describe("ruleSpeedLabel", () => {
  it("shows a usable speed even for a nonsense stored value", () => {
    expect(ruleSpeedLabel(1.5)).toBe("1.5x");
    expect(ruleSpeedLabel(99)).toBe("4x");
  });
});
