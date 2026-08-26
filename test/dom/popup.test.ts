// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import type { ContentState } from "../../src/platform/messages";
import { SETTINGS_KEY, createSettingsStore } from "../../src/platform/storage";
import { createTabClient } from "../../src/popup/tab-client";
import { renderPopup } from "../../src/popup/view";
import { createFakeBrowser, type FakeBrowser } from "../helpers/fake-browser";

let browser: FakeBrowser;
let root: HTMLElement;
let openedOptions: number;
let frameState: ContentState | null;

const baseState = (): ContentState => ({
  url: "https://example.com/watch",
  speed: 2,
  ruleSpeed: 2,
  override: null,
  tier: 0,
  mediaCount: 1,
});

/** Stands in for the content script answering the popup. */
function answerAs(handler: (request: unknown) => ContentState | null): void {
  browser.tabs.sendMessage = async (_tabId, message) => handler(message);
}

async function mount(): Promise<void> {
  const handle = renderPopup(root, {
    client: createTabClient(browser),
    settings: createSettingsStore(browser),
    openOptions: () => {
      openedOptions += 1;
    },
  });
  await handle.ready;
}

function click(selector: string): void {
  root.querySelector<HTMLElement>(selector)?.click();
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = "<main id='root'></main>";
  root = document.getElementById("root") as HTMLElement;
  browser = createFakeBrowser();
  browser.activeTabs = [{ id: 1 }];
  openedOptions = 0;
  frameState = baseState();
  answerAs((message) => {
    const request = message as { type: string; speed?: number };
    if (request.type === "set-speed" && frameState) {
      frameState = { ...frameState, speed: request.speed ?? 2, override: request.speed ?? 2 };
    }
    return frameState;
  });
});

describe("what it shows", () => {
  it("reads out the current speed and the site", async () => {
    await mount();
    expect(root.querySelector(".readout")?.textContent).toContain("2x");
    expect(root.querySelector(".host")?.textContent).toBe("example.com");
  });

  it("marks the preset that matches the current speed", async () => {
    await mount();
    const pressed = [...root.querySelectorAll(".preset")].filter(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.textContent).toBe("2x");
  });

  it("explains itself when there is no content script to talk to", async () => {
    browser.activeTabs = [];
    await mount();
    expect(root.querySelector(".note")?.textContent).toMatch(/no media controls/i);
    expect(root.querySelector(".footer")).toBeNull();
  });

  it("counts the players on the page", async () => {
    frameState = { ...baseState(), mediaCount: 3 };
    await mount();
    expect(root.querySelector(".count")?.textContent).toBe("3 players");
  });

  it("says when the speed applies to this tab only, and offers to undo it", async () => {
    frameState = { ...baseState(), speed: 3, override: 3 };
    await mount();
    expect(root.querySelector(".badge")?.textContent).toBe("this tab · reset to 2x");

    const seen: unknown[] = [];
    answerAs((message) => {
      seen.push(message);
      frameState = baseState();
      return frameState;
    });
    click('[data-act="reset"]');
    await settle();
    expect(seen).toEqual([{ type: "command", command: "reset-default" }]);
    expect(root.querySelector(".readout")?.textContent).toContain("2x");
  });

  it("calls a page with no readable URL simply this page", async () => {
    frameState = { ...baseState(), url: "about:blank" };
    await mount();
    expect(root.querySelector(".host")?.textContent).toBe("this page");
  });
});

describe("changing the speed", () => {
  it("steps up and down through the content script", async () => {
    const seen: unknown[] = [];
    answerAs((message) => {
      seen.push(message);
      return frameState;
    });
    await mount();

    click('[data-act="up"]');
    await settle();
    click('[data-act="down"]');
    await settle();

    expect(seen).toEqual([
      { type: "get-state" },
      { type: "command", command: "speed-up" },
      { type: "command", command: "speed-down" },
    ]);
  });

  it("applies a preset and redraws", async () => {
    await mount();
    const preset = [...root.querySelectorAll<HTMLElement>(".preset")].find(
      (button) => button.textContent === "3x",
    );
    preset?.click();
    await settle();
    expect(root.querySelector(".readout")?.textContent).toContain("3x");
  });
});

describe("pinning a site", () => {
  it("pins the site at normal speed", async () => {
    await mount();
    click('[data-act="pin-normal"]');
    await settle();

    const stored = browser.store.get(SETTINGS_KEY) as { rules: { pattern: string; speed: number }[] };
    expect(stored.rules).toEqual([
      expect.objectContaining({ pattern: "example.com", speed: 1 }),
    ]);
    expect(root.querySelector(".pinned")?.textContent).toBe("pinned at 1x");
  });

  it("pins the site at whatever it is playing at now", async () => {
    frameState = { ...baseState(), speed: 2.5, override: 2.5 };
    await mount();
    click('[data-act="pin-current"]');
    await settle();

    const stored = browser.store.get(SETTINGS_KEY) as { rules: { speed: number }[] };
    expect(stored.rules[0]?.speed).toBe(2.5);
  });

  it("unpins", async () => {
    browser.seed({
      [SETTINGS_KEY]: {
        ...DEFAULT_SETTINGS,
        rules: [{ id: "a", pattern: "example.com", speed: 1, enabled: true }],
      },
    });
    await mount();
    click('[data-act="unpin"]');
    await settle();

    const stored = browser.store.get(SETTINGS_KEY) as { rules: unknown[] };
    expect(stored.rules).toEqual([]);
  });

  it("does not pin when there is no page to pin", async () => {
    browser.activeTabs = [];
    await mount();
    expect(root.querySelector('[data-act="pin-normal"]')).toBeNull();
  });
});

describe("the default speed", () => {
  it("saves a new default", async () => {
    await mount();
    const input = root.querySelector<HTMLInputElement>('input[data-act="default"]');
    expect(input?.value).toBe("2");
    if (input) {
      input.value = "1.5";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await settle();
    expect((browser.store.get(SETTINGS_KEY) as { defaultSpeed: number }).defaultSpeed).toBe(1.5);
  });

  it("ignores a change event from something else", async () => {
    await mount();
    root.querySelector(".presets")?.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(browser.store.has(SETTINGS_KEY)).toBe(false);
  });
});

describe("other clicks", () => {
  it("opens the settings page", async () => {
    await mount();
    click('[data-act="options"]');
    await settle();
    expect(openedOptions).toBe(1);
  });

  it("ignores a click on the background", async () => {
    await mount();
    const before = root.innerHTML;
    root.click();
    await settle();
    expect(root.innerHTML).toBe(before);
  });

  it("ignores an action it does not know", async () => {
    await mount();
    const stray = document.createElement("button");
    stray.dataset.act = "self-destruct";
    root.append(stray);
    stray.click();
    await settle();
    expect(browser.store.has(SETTINGS_KEY)).toBe(false);
  });
});

describe("the tab client", () => {
  it("returns nothing when messaging fails", async () => {
    browser.tabs.sendMessage = () => Promise.reject(new Error("no receiving end"));
    const client = createTabClient(browser);
    expect(await client.getState()).toBeNull();
  });

  it("returns nothing when the reply is not a frame state", async () => {
    answerAs(() => ({ nonsense: true }) as unknown as ContentState);
    expect(await createTabClient(browser).getState()).toBeNull();

    answerAs(() => null);
    expect(await createTabClient(browser).getState()).toBeNull();
  });

  it("returns nothing on a browser with no tabs API at all", async () => {
    delete (browser as { tabs?: unknown }).tabs;
    expect(await createTabClient(browser).getState()).toBeNull();
  });

  it("refuses to send a request the content script would not understand", async () => {
    const sent = vi.spyOn(browser.tabs, "sendMessage");
    const client = createTabClient(browser);
    expect(await client.send({ type: "nonsense" } as never)).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });

  it("finds the browser API itself when it is not handed one", async () => {
    (globalThis as Record<string, unknown>).browser = browser;
    try {
      expect(await createTabClient().getState()).not.toBeNull();
    } finally {
      delete (globalThis as Record<string, unknown>).browser;
    }
  });
});
