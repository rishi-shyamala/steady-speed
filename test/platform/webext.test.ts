import { describe, expect, it } from "vitest";
import { getBrowser } from "../../src/platform/webext";
import { createFakeBrowser } from "../helpers/fake-browser";

describe("getBrowser", () => {
  it("prefers Firefox's promise-based `browser`", () => {
    const browser = createFakeBrowser();
    const chrome = createFakeBrowser();
    expect(getBrowser({ browser, chrome })).toBe(browser);
  });

  it("falls back to `chrome`, which is what a Chromium build sees", () => {
    const chrome = createFakeBrowser();
    expect(getBrowser({ chrome })).toBe(chrome);
  });

  it("fails loudly rather than silently doing nothing", () => {
    expect(() => getBrowser({})).toThrow(/unavailable/i);
  });
});
