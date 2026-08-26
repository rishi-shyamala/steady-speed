/**
 * The hot paths, measured.
 *
 * Only two things run often enough to matter: resolving which speed a page
 * should play at (once per settings change and once per frame load) and the
 * comparison the enforcer makes on every media event. Everything else happens
 * at most a few times per page.
 */
import { bench, describe } from "vitest";
import { resolveSpeed, parsePattern, parseTarget, patternMatches } from "../../src/core/rules";
import { normalizeSettings } from "../../src/core/settings";
import { conformSpeed, speedsEqual, stepSpeed } from "../../src/core/speed";

const smallRules = [
  { id: "a", pattern: "music.youtube.com", speed: 1, enabled: true },
  { id: "b", pattern: "meet.google.com", speed: 1, enabled: true },
];

const largeRules = Array.from({ length: 200 }, (_, index) => ({
  id: `r${index}`,
  pattern: `site${index}.example.com/section/${index}`,
  speed: 1,
  enabled: true,
}));

const url = "https://www.youtube.com/watch?v=abcdefghijk";

describe("resolving a speed", () => {
  bench("no rules", () => {
    resolveSpeed(url, [], 2);
  });

  bench("a handful of rules", () => {
    resolveSpeed(url, smallRules, 2);
  });

  bench("two hundred rules", () => {
    resolveSpeed(url, largeRules, 2);
  });
});

describe("matching one pattern", () => {
  const pattern = parsePattern("*.youtube.com/watch");
  const target = parseTarget(url);

  bench("parsed pattern against a parsed URL", () => {
    if (pattern && target) patternMatches(pattern, target);
  });

  bench("parsing a pattern", () => {
    parsePattern("*.youtube.com/watch");
  });
});

describe("speed arithmetic", () => {
  bench("comparing a rate to the target", () => {
    speedsEqual(2.0000001, 2);
  });

  bench("conforming a stored value", () => {
    conformSpeed(2.004);
  });

  bench("stepping", () => {
    stepSpeed(2, 0.25, 1);
  });
});

describe("loading settings", () => {
  const stored = { version: 1, defaultSpeed: 2, rules: largeRules };

  bench("normalising a stored blob with two hundred rules", () => {
    normalizeSettings(stored);
  });
});
