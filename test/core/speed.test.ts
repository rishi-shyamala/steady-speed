import { describe, expect, it } from "vitest";
import {
  MAX_SPEED,
  MIN_SPEED,
  NORMAL_SPEED,
  clampSpeed,
  conformSpeed,
  formatBadge,
  formatSpeed,
  roundSpeed,
  speedsEqual,
  stepSpeed,
} from "../../src/core/speed";

describe("bounds", () => {
  it("are the range Firefox keeps audio audible in", () => {
    expect(MIN_SPEED).toBe(0.25);
    expect(MAX_SPEED).toBe(4);
    expect(NORMAL_SPEED).toBe(1);
  });
});

describe("roundSpeed", () => {
  it("keeps two decimal places", () => {
    expect(roundSpeed(1.234)).toBe(1.23);
    expect(roundSpeed(1.235)).toBe(1.24);
  });

  it("removes float drift from repeated stepping", () => {
    expect(roundSpeed(0.1 + 0.2)).toBe(0.3);
    expect(roundSpeed(2.7500000000000004)).toBe(2.75);
  });

  it("never returns negative zero", () => {
    expect(Object.is(roundSpeed(-0.001), 0)).toBe(true);
  });
});

describe("clampSpeed", () => {
  it("passes values already inside the range", () => {
    expect(clampSpeed(2)).toBe(2);
    expect(clampSpeed(MIN_SPEED)).toBe(MIN_SPEED);
    expect(clampSpeed(MAX_SPEED)).toBe(MAX_SPEED);
  });

  it("pulls values back to the nearest bound", () => {
    expect(clampSpeed(0.01)).toBe(MIN_SPEED);
    expect(clampSpeed(16)).toBe(MAX_SPEED);
    expect(clampSpeed(-5)).toBe(MIN_SPEED);
  });
});

describe("conformSpeed", () => {
  it("rounds and clamps in one pass", () => {
    expect(conformSpeed(2.004)).toBe(2);
    expect(conformSpeed(99)).toBe(MAX_SPEED);
  });

  it("falls back for values that are not usable numbers", () => {
    expect(conformSpeed(Number.NaN)).toBe(NORMAL_SPEED);
    expect(conformSpeed(Number.POSITIVE_INFINITY)).toBe(NORMAL_SPEED);
    expect(conformSpeed("2")).toBe(NORMAL_SPEED);
    expect(conformSpeed(null)).toBe(NORMAL_SPEED);
    expect(conformSpeed(undefined)).toBe(NORMAL_SPEED);
    expect(conformSpeed({})).toBe(NORMAL_SPEED);
  });

  it("uses the supplied fallback, itself conformed", () => {
    expect(conformSpeed("nope", 2.5)).toBe(2.5);
    expect(conformSpeed("nope", 99)).toBe(MAX_SPEED);
    expect(conformSpeed("nope", Number.NaN)).toBe(NORMAL_SPEED);
  });
});

describe("stepSpeed", () => {
  it("moves to the next value on the step grid", () => {
    expect(stepSpeed(2, 0.25, 1)).toBe(2.25);
    expect(stepSpeed(2, 0.25, -1)).toBe(1.75);
  });

  it("snaps a value that is off the grid onto it", () => {
    expect(stepSpeed(1.1, 0.25, 1)).toBe(1.25);
    expect(stepSpeed(1.1, 0.25, -1)).toBe(1);
  });

  it("does not move past the bounds", () => {
    expect(stepSpeed(MAX_SPEED, 0.25, 1)).toBe(MAX_SPEED);
    expect(stepSpeed(MIN_SPEED, 0.25, -1)).toBe(MIN_SPEED);
    expect(stepSpeed(3.9, 0.25, 1)).toBe(MAX_SPEED);
    expect(stepSpeed(0.3, 0.25, -1)).toBe(MIN_SPEED);
  });

  it("survives many steps without accumulating float error", () => {
    let speed = MIN_SPEED;
    for (let i = 0; i < 15; i += 1) speed = stepSpeed(speed, 0.25, 1);
    expect(speed).toBe(4);
    for (let i = 0; i < 15; i += 1) speed = stepSpeed(speed, 0.25, -1);
    expect(speed).toBe(0.25);
  });

  it("treats a non-positive or unusable step as the default step", () => {
    expect(stepSpeed(2, 0, 1)).toBe(2.25);
    expect(stepSpeed(2, -0.5, 1)).toBe(2.25);
    expect(stepSpeed(2, Number.NaN, 1)).toBe(2.25);
  });

  it("treats a step finer than the two decimals we keep as the default step", () => {
    expect(stepSpeed(2, 0.004, 1)).toBe(2.25);
  });

  it("works with a finer step", () => {
    expect(stepSpeed(2, 0.1, 1)).toBe(2.1);
    expect(stepSpeed(2, 0.1, -1)).toBe(1.9);
  });
});

describe("speedsEqual", () => {
  it("treats values within rounding tolerance as the same", () => {
    expect(speedsEqual(2, 2.001)).toBe(true);
    expect(speedsEqual(2, 2.02)).toBe(false);
  });

  it("is safe against float representation noise", () => {
    expect(speedsEqual(0.1 + 0.2, 0.3)).toBe(true);
  });
});

describe("formatSpeed", () => {
  it("drops trailing zeros", () => {
    expect(formatSpeed(2)).toBe("2x");
    expect(formatSpeed(1.5)).toBe("1.5x");
    expect(formatSpeed(1.25)).toBe("1.25x");
    expect(formatSpeed(0.25)).toBe("0.25x");
  });
});

describe("formatBadge", () => {
  it("shows nothing at normal speed, so the toolbar stays quiet", () => {
    expect(formatBadge(1)).toBe("");
    expect(formatBadge(1.001)).toBe("");
  });

  it("fits inside the four characters a badge shows", () => {
    for (let speed = MIN_SPEED; speed <= MAX_SPEED + 0.001; speed += 0.05) {
      expect(formatBadge(roundSpeed(speed)).length).toBeLessThanOrEqual(4);
    }
  });

  it("drops the leading zero below 1x to save a character", () => {
    expect(formatBadge(0.5)).toBe(".5");
    expect(formatBadge(0.25)).toBe(".25");
  });

  it("reads naturally above 1x", () => {
    expect(formatBadge(2)).toBe("2");
    expect(formatBadge(1.75)).toBe("1.75");
    expect(formatBadge(4)).toBe("4");
  });
});
