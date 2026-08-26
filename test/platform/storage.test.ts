import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { SETTINGS_KEY, createSettingsStore } from "../../src/platform/storage";
import { createFakeBrowser, type FakeBrowser } from "../helpers/fake-browser";

let browser: FakeBrowser;

beforeEach(() => {
  browser = createFakeBrowser();
});

describe("load", () => {
  it("returns the defaults when nothing has been stored", async () => {
    const store = createSettingsStore(browser);
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("normalises whatever is stored, so a corrupt value cannot break playback", async () => {
    browser.seed({ [SETTINGS_KEY]: { version: 1, defaultSpeed: 99, rules: "nope" } });
    const settings = await createSettingsStore(browser).load();
    expect(settings.defaultSpeed).toBe(4);
    expect(settings.rules).toEqual([]);
  });

  it("falls back to the defaults if storage itself fails", async () => {
    browser.storage.local.get = () => Promise.reject(new Error("storage unavailable"));
    expect(await createSettingsStore(browser).load()).toEqual(DEFAULT_SETTINGS);
  });

  it("reads only its own key", async () => {
    const get = vi.spyOn(browser.storage.local, "get");
    await createSettingsStore(browser).load();
    expect(get).toHaveBeenCalledWith(SETTINGS_KEY);
  });
});

describe("save", () => {
  it("writes under a single key", async () => {
    const store = createSettingsStore(browser);
    await store.save({ ...DEFAULT_SETTINGS, defaultSpeed: 3, presets: [1], rules: [] });
    expect([...browser.store.keys()]).toEqual([SETTINGS_KEY]);
    expect(await store.load()).toMatchObject({ defaultSpeed: 3 });
  });
});

describe("update", () => {
  it("reads, applies, writes, and hands back the result", async () => {
    const store = createSettingsStore(browser);
    const next = await store.update((current) => ({ ...current, defaultSpeed: 1.5 }));
    expect(next.defaultSpeed).toBe(1.5);
    expect(await store.load()).toMatchObject({ defaultSpeed: 1.5 });
  });
});

describe("subscribe", () => {
  it("delivers normalised settings when the stored value changes", async () => {
    const store = createSettingsStore(browser);
    const seen: number[] = [];
    store.subscribe((settings) => seen.push(settings.defaultSpeed));

    await store.save({ ...DEFAULT_SETTINGS, defaultSpeed: 3, presets: [1], rules: [] });
    expect(seen).toEqual([3]);
  });

  it("reports the defaults when the stored value is removed", async () => {
    const store = createSettingsStore(browser);
    await store.save({ ...DEFAULT_SETTINGS, defaultSpeed: 3, presets: [1], rules: [] });

    const seen: number[] = [];
    store.subscribe((settings) => seen.push(settings.defaultSpeed));
    await browser.storage.local.remove(SETTINGS_KEY);
    expect(seen).toEqual([DEFAULT_SETTINGS.defaultSpeed]);
  });

  it("ignores changes to other keys and other areas", async () => {
    const store = createSettingsStore(browser);
    const listener = vi.fn();
    store.subscribe(listener);

    await browser.storage.local.set({ somethingElse: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores changes in another storage area", async () => {
    const add = vi.spyOn(browser.storage.onChanged, "addListener");
    const store = createSettingsStore(browser);
    const listener = vi.fn();
    store.subscribe(listener);

    const registered = add.mock.calls[0]?.[0];
    registered?.({ [SETTINGS_KEY]: { newValue: { version: 1 } } }, "sync");
    expect(listener).not.toHaveBeenCalled();
  });

  it("swallows a subscriber error when no error handler was given", async () => {
    const store = createSettingsStore(browser);
    store.subscribe(() => {
      throw new Error("subscriber blew up");
    });

    await expect(
      store.save({ ...DEFAULT_SETTINGS, presets: [1], rules: [] }),
    ).resolves.toBeUndefined();
  });

  it("stops delivering once unsubscribed", async () => {
    const store = createSettingsStore(browser);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    await store.save({ ...DEFAULT_SETTINGS, presets: [1], rules: [] });
    expect(listener).not.toHaveBeenCalled();
  });

  it("registers exactly one browser listener however many subscribers there are", () => {
    const add = vi.spyOn(browser.storage.onChanged, "addListener");
    const store = createSettingsStore(browser);
    store.subscribe(() => {});
    store.subscribe(() => {});
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("keeps delivering to the other subscribers when one of them throws", async () => {
    const onError = vi.fn();
    const store = createSettingsStore(browser, onError);
    const good = vi.fn();
    const boom = new Error("subscriber blew up");

    store.subscribe(() => {
      throw boom;
    });
    store.subscribe(good);

    await store.save({ ...DEFAULT_SETTINGS, presets: [1], rules: [] });
    expect(good).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
  });
});
