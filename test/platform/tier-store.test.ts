import { beforeEach, describe, expect, it } from "vitest";
import { MAX_LEARNED_TIERS, TIERS_KEY, createTierStore } from "../../src/platform/storage";
import { createFakeBrowser, type FakeBrowser } from "../helpers/fake-browser";

let browser: FakeBrowser;

beforeEach(() => {
  browser = createFakeBrowser();
});

describe("remembering", () => {
  it("knows nothing about a host it has never seen", async () => {
    expect(await createTierStore(browser).get("example.com")).toBeNull();
  });

  it("remembers a tier and reads it back", async () => {
    const store = createTierStore(browser);
    await store.set("example.com", 2);
    expect(await store.get("example.com")).toBe(2);
  });

  it("forgets a host rather than storing a zero", async () => {
    const store = createTierStore(browser);
    await store.set("example.com", 3);
    await store.set("example.com", 0);
    expect(await store.get("example.com")).toBeNull();
  });

  it("writes nothing when the tier has not changed", async () => {
    const store = createTierStore(browser);
    await store.set("example.com", 2);
    const before = structuredClone(browser.store.get(TIERS_KEY));
    await store.set("example.com", 2);
    expect(browser.store.get(TIERS_KEY)).toEqual(before);
  });

  it("writes nothing when asked to forget a host it does not hold", async () => {
    const store = createTierStore(browser);
    await store.set("example.com", 0);
    expect(browser.store.has(TIERS_KEY)).toBe(false);
  });

  it("ignores an empty host, which is what a file:// page has", async () => {
    const store = createTierStore(browser);
    await store.set("", 3);
    expect(browser.store.has(TIERS_KEY)).toBe(false);
  });
});

describe("bad stored data", () => {
  it("survives a value that is not a map", async () => {
    browser.seed({ [TIERS_KEY]: "corrupt" });
    expect(await createTierStore(browser).get("example.com")).toBeNull();
  });

  it("clamps a tier that is out of range", async () => {
    browser.seed({ [TIERS_KEY]: { low: -4, high: 99, fractional: 2.4, broken: Number.NaN } });
    const store = createTierStore(browser);
    expect(await store.get("low")).toBe(0);
    expect(await store.get("high")).toBe(3);
    expect(await store.get("fractional")).toBe(2);
    expect(await store.get("broken")).toBe(0);
  });

  it("degrades to knowing nothing if storage fails", async () => {
    browser.storage.local.get = () => Promise.reject(new Error("unavailable"));
    expect(await createTierStore(browser).get("example.com")).toBeNull();
  });
});

describe("bounded growth", () => {
  it("keeps only the most recently written hosts", async () => {
    const store = createTierStore(browser);
    for (let i = 0; i < MAX_LEARNED_TIERS + 5; i += 1) {
      await store.set(`host${i}.test`, 2);
    }
    const stored = browser.store.get(TIERS_KEY) as Record<string, number>;
    expect(Object.keys(stored)).toHaveLength(MAX_LEARNED_TIERS);
    expect(await store.get("host0.test")).toBeNull();
    expect(await store.get(`host${MAX_LEARNED_TIERS + 4}.test`)).toBe(2);
  });

  it("moves a host to the front when its tier changes", async () => {
    const store = createTierStore(browser);
    await store.set("first.test", 1);
    await store.set("second.test", 1);
    await store.set("first.test", 2);
    expect(Object.keys(browser.store.get(TIERS_KEY) as object)).toEqual([
      "second.test",
      "first.test",
    ]);
  });
});

describe("clear", () => {
  it("forgets everything", async () => {
    const store = createTierStore(browser);
    await store.set("example.com", 2);
    await store.clear();
    expect(await store.get("example.com")).toBeNull();
  });
});
