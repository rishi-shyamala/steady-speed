// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { effectiveUrl, startController, type Controller } from "../../src/content/controller";
import { SETTINGS_KEY, TIERS_KEY } from "../../src/platform/storage";
import { createFakeBrowser, type FakeBrowser } from "../helpers/fake-browser";

let browser: FakeBrowser;
let controller: Controller | null = null;
let href: string;

function fakeWindow(): Window & typeof globalThis {
  return {
    document,
    get location() {
      return { href } as Location;
    },
  } as unknown as Window & typeof globalThis;
}

async function start(): Promise<Controller> {
  controller = startController({ window: fakeWindow(), api: browser });
  await controller.ready;
  return controller;
}

/**
 * happy-dom tries to fetch an injected `<script src>` and fires a synchronous
 * error when it cannot, which the bridge reads as "the page blocked us". Real
 * browsers load an extension URL fine, so the loader is stubbed out here.
 */
function stubScriptLoading(): () => void {
  const prototype = HTMLScriptElement.prototype as unknown as Record<string, unknown>;
  const original = Object.getOwnPropertyDescriptor(prototype, "src");
  Object.defineProperty(prototype, "src", {
    configurable: true,
    get(this: HTMLScriptElement) {
      return this.getAttribute("data-src") ?? "";
    },
    set(this: HTMLScriptElement, value: string) {
      this.setAttribute("data-src", value);
    },
  });
  return () => {
    if (original) Object.defineProperty(prototype, "src", original);
  };
}

let restoreScriptLoading: () => void;

function video(): HTMLVideoElement {
  const element = document.createElement("video");
  document.body.append(element);
  return element;
}

function settings(overrides: Record<string, unknown> = {}): void {
  browser.seed({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, ...overrides } });
}

beforeEach(() => {
  restoreScriptLoading = stubScriptLoading();
  document.body.innerHTML = "";
  for (const stale of document.querySelectorAll("script[data-steady-key]")) stale.remove();
  browser = createFakeBrowser();
  href = "https://example.com/watch";
});

afterEach(() => {
  controller?.stop();
  controller = null;
  restoreScriptLoading();
});

describe("effectiveUrl", () => {
  it("uses the frame's own URL when it has a host", () => {
    expect(effectiveUrl("https://example.com/x", "https://other.test/")).toBe(
      "https://example.com/x",
    );
  });

  it("falls back to the opener for an about:blank frame", () => {
    expect(effectiveUrl("about:blank", "https://example.com/")).toBe("https://example.com/");
  });

  it("keeps the frame's URL when there is nothing to fall back to", () => {
    expect(effectiveUrl("about:blank", "")).toBe("about:blank");
    expect(effectiveUrl("not a url", "")).toBe("not a url");
  });
});

describe("applying the default", () => {
  it("brings media on the page to the default speed", async () => {
    const media = video();
    await start();
    expect(media.playbackRate).toBe(DEFAULT_SETTINGS.defaultSpeed);
  });

  it("uses a stored default rather than the built-in one", async () => {
    settings({ defaultSpeed: 3 });
    const media = video();
    await start();
    expect(media.playbackRate).toBe(3);
  });

  it("applies to media that turns up later", async () => {
    await start();
    const media = video();
    media.dispatchEvent(new Event("play"));
    expect(media.playbackRate).toBe(DEFAULT_SETTINGS.defaultSpeed);
  });
});

describe("site rules", () => {
  it("pins a site to 1x when a rule says so", async () => {
    settings({
      defaultSpeed: 2,
      rules: [{ id: "a", pattern: "example.com", speed: 1, enabled: true }],
    });
    const media = video();
    await start();
    expect(media.playbackRate).toBe(1);
  });

  it("leaves other sites on the default", async () => {
    settings({
      defaultSpeed: 2,
      rules: [{ id: "a", pattern: "other.test", speed: 1, enabled: true }],
    });
    const media = video();
    await start();
    expect(media.playbackRate).toBe(2);
  });

  it("follows a settings change without a reload", async () => {
    const media = video();
    await start();
    expect(media.playbackRate).toBe(2);

    await browser.storage.local.set({
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, defaultSpeed: 1.5 },
    });
    expect(media.playbackRate).toBe(1.5);
  });
});

describe("commands", () => {
  it("steps up and down by the configured step", async () => {
    const media = video();
    await start();

    browser.deliverMessage({ type: "command", command: "speed-up" });
    expect(media.playbackRate).toBe(2.25);
    browser.deliverMessage({ type: "command", command: "speed-down" });
    expect(media.playbackRate).toBe(2);
  });

  it("toggles between normal and the site's speed", async () => {
    const media = video();
    await start();

    browser.deliverMessage({ type: "command", command: "toggle-normal" });
    expect(media.playbackRate).toBe(1);
    browser.deliverMessage({ type: "command", command: "toggle-normal" });
    expect(media.playbackRate).toBe(2);
  });

  it("resets back to what the rules say", async () => {
    const media = video();
    await start();

    browser.deliverMessage({ type: "set-speed", speed: 3.5 });
    expect(media.playbackRate).toBe(3.5);
    browser.deliverMessage({ type: "command", command: "reset-default" });
    expect(media.playbackRate).toBe(2);
  });

  it("ignores messages it does not recognise", async () => {
    const media = video();
    await start();
    browser.deliverMessage({ type: "burn-it-down" });
    expect(media.playbackRate).toBe(2);
  });
});

describe("state", () => {
  it("describes the frame for the popup", async () => {
    settings({ defaultSpeed: 2 });
    video();
    const active = await start();

    expect(active.state).toMatchObject({
      url: "https://example.com/watch",
      speed: 2,
      ruleSpeed: 2,
      override: null,
      tier: 0,
      mediaCount: 1,
    });
  });

  it("shows an override separately from the rule speed", async () => {
    await start();
    browser.deliverMessage({ type: "set-speed", speed: 3 });
    expect(controller?.state).toMatchObject({ speed: 3, ruleSpeed: 2, override: 3 });
  });

  it("answers a state request over messaging", async () => {
    await start();
    expect(browser.deliverMessage({ type: "get-state" })).toEqual([
      expect.objectContaining({ speed: 2 }),
    ]);
  });

  it("says nothing at all to a message it does not recognise", async () => {
    await start();
    expect(browser.deliverMessage({ type: "burn-it-down" })).toEqual([]);
  });
});

describe("reporting to the toolbar", () => {
  it("tells the background what this frame settled on", async () => {
    video();
    await start();
    expect(browser.sent).toEqual([{ type: "speed-changed", speed: 2 }]);
  });

  it("does not repeat itself when nothing changed", async () => {
    await start();
    browser.deliverMessage({ type: "command", command: "reset-default" });
    expect(browser.sent).toHaveLength(1);
  });

  it("reports a change once", async () => {
    await start();
    browser.deliverMessage({ type: "set-speed", speed: 3 });
    expect(browser.sent).toEqual([
      { type: "speed-changed", speed: 2 },
      { type: "speed-changed", speed: 3 },
    ]);
  });
});

describe("learned tiers", () => {
  it("starts at the tier this site needed last time", async () => {
    browser.seed({ [TIERS_KEY]: { "example.com": 2 } });
    const active = await start();
    expect(active.state.tier).toBe(2);
  });

  it("ignores a learned tier lower than where it already is", async () => {
    browser.seed({ [TIERS_KEY]: { "example.com": 1 } });
    const media = video();
    await start();

    media.playbackRate = 1;
    media.dispatchEvent(new Event("ratechange"));
    expect(controller?.state.tier).toBe(1);
  });

  it("remembers a tier it had to climb to", async () => {
    const media = video();
    await start();

    media.playbackRate = 1;
    media.dispatchEvent(new Event("ratechange"));
    await Promise.resolve();
    await Promise.resolve();
    expect(browser.store.get(TIERS_KEY)).toEqual({ "example.com": 1 });
  });
});

describe("the page-world agent", () => {
  it("injects when the site is known to need the top rung", async () => {
    browser.seed({ [TIERS_KEY]: { "example.com": 3 } });
    await start();
    const script = document.querySelector<HTMLScriptElement>("script[data-steady-key]");
    expect(script?.src).toBe("moz-extension://fake/page-agent.js");
  });

  it("keeps the agent's target up to date when the speed changes", async () => {
    browser.seed({ [TIERS_KEY]: { "example.com": 3 } });
    await start();
    const script = document.querySelector<HTMLScriptElement>("script[data-steady-key]");
    const commands: unknown[] = [];
    const key = script?.dataset.steadyKey ?? "";
    document.addEventListener(`steady-cmd-${key}`, (event) => {
      commands.push(JSON.parse((event as CustomEvent<string>).detail));
    });

    // The agent announces itself, then the popup asks for a different speed.
    document.dispatchEvent(
      new CustomEvent(`steady-msg-${key}`, { detail: JSON.stringify({ type: "ready" }) }),
    );
    browser.deliverMessage({ type: "set-speed", speed: 3 });

    expect(commands).toContainEqual({ type: "target", speed: 3, preservePitch: true });
  });

  it("stays out of the page when page-world injection is switched off", async () => {
    settings({ enforcement: { autoEscalate: true, allowPageWorld: false } });
    browser.seed({ [TIERS_KEY]: { "example.com": 3 } });
    await start();
    expect(document.querySelector("script[data-steady-key]")).toBeNull();
  });
});

describe("hidden tabs", () => {
  it("follows the page's visibility", async () => {
    await start();
    expect(() => document.dispatchEvent(new Event("visibilitychange"))).not.toThrow();
  });
});

describe("awkward URLs", () => {
  it("copes with a frame whose URL is not a URL at all", async () => {
    href = "not a url";
    const media = video();
    const active = await start();
    expect(media.playbackRate).toBe(2);
    expect(active.state.url).toBe("not a url");
  });

  it("stores no learned tier for a page with no host", async () => {
    href = "file:///home/rishi/clip.mp4";
    const media = video();
    await start();

    media.playbackRate = 1;
    media.dispatchEvent(new Event("ratechange"));
    await Promise.resolve();
    expect(browser.store.has(TIERS_KEY)).toBe(false);
  });
});

describe("resilience", () => {
  it("carries on when the background page is not listening", async () => {
    browser.runtime.sendMessage = () => Promise.reject(new Error("no receiving end"));
    const media = video();
    await start();
    await Promise.resolve();
    expect(media.playbackRate).toBe(2);
  });

  it("finds the browser API itself when it is not handed one", async () => {
    (globalThis as Record<string, unknown>).browser = browser;
    try {
      const media = video();
      controller = startController({ window: fakeWindow() });
      await controller.ready;
      expect(media.playbackRate).toBe(2);
    } finally {
      delete (globalThis as Record<string, unknown>).browser;
    }
  });
});

describe("teardown", () => {
  it("stops applying to new media", async () => {
    await start();
    controller?.stop();
    controller = null;

    const media = video();
    media.dispatchEvent(new Event("play"));
    expect(media.playbackRate).toBe(1);
  });

  it("stops answering messages", async () => {
    await start();
    controller?.stop();
    controller = null;
    expect(browser.deliverMessage({ type: "get-state" })).toEqual([]);
  });
});
