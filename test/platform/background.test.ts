import { beforeEach, describe, expect, it } from "vitest";
import { startBackground } from "../../src/background/index";
import { createFakeBrowser, type FakeBrowser } from "../helpers/fake-browser";

let browser: FakeBrowser;

beforeEach(() => {
  browser = createFakeBrowser();
});

describe("hotkeys", () => {
  it("forwards a command to the tab the browser handed it", () => {
    startBackground(browser);
    browser.fireCommand("speed-up", { id: 7 });
    expect(browser.tabMessages).toEqual([
      { tabId: 7, message: { type: "command", command: "speed-up" } },
    ]);
  });

  it("forwards every command the manifest declares", () => {
    startBackground(browser);
    for (const command of ["speed-up", "speed-down", "toggle-normal", "reset-default"]) {
      browser.fireCommand(command, { id: 1 });
    }
    expect(browser.tabMessages).toHaveLength(4);
  });

  it("ignores a command it does not know", () => {
    startBackground(browser);
    browser.fireCommand("something-else", { id: 7 });
    expect(browser.tabMessages).toEqual([]);
  });

  it("does nothing when there is no tab to talk to", () => {
    startBackground(browser);
    browser.fireCommand("speed-up");
    browser.fireCommand("speed-up", {});
    expect(browser.tabMessages).toEqual([]);
  });

  it("survives a tab that has already gone away", async () => {
    browser.tabs.sendMessage = () => Promise.reject(new Error("no receiving end"));
    startBackground(browser);
    expect(() => browser.fireCommand("speed-up", { id: 7 })).not.toThrow();
    await Promise.resolve();
  });
});

describe("the toolbar badge", () => {
  it("colours the badge once at startup", () => {
    startBackground(browser);
    expect(browser.badgeColor).toBe("#0B6E62");
  });

  it("shows the speed of the tab that reported it", () => {
    startBackground(browser);
    browser.deliverMessage({ type: "speed-changed", speed: 2 }, { tab: { id: 3 }, frameId: 0 });
    expect(browser.badges.get("3")).toBe("2");
    expect(browser.titles.get("3")).toBe("Steady — 2x");
  });

  it("stays blank at normal speed, so the toolbar is quiet", () => {
    startBackground(browser);
    browser.deliverMessage({ type: "speed-changed", speed: 1 }, { tab: { id: 3 }, frameId: 0 });
    expect(browser.badges.get("3")).toBe("");
  });

  it("listens only to the top frame, not to every iframe on the page", () => {
    startBackground(browser);
    browser.deliverMessage({ type: "speed-changed", speed: 3 }, { tab: { id: 3 }, frameId: 9 });
    expect(browser.badges.has("3")).toBe(false);
  });

  it("accepts a report with no frame id at all", () => {
    startBackground(browser);
    browser.deliverMessage({ type: "speed-changed", speed: 3 }, { tab: { id: 3 } });
    expect(browser.badges.get("3")).toBe("3");
  });

  it("ignores a message that did not come from a tab", () => {
    startBackground(browser);
    browser.deliverMessage({ type: "speed-changed", speed: 3 }, {});
    expect(browser.badges.size).toBe(0);
  });

  it("ignores messages it does not recognise", () => {
    startBackground(browser);
    browser.deliverMessage({ type: "something" }, { tab: { id: 3 }, frameId: 0 });
    expect(browser.badges.size).toBe(0);
  });
});

describe("teardown", () => {
  it("stops listening", () => {
    const handle = startBackground(browser);
    handle.stop();
    browser.deliverMessage({ type: "speed-changed", speed: 2 }, { tab: { id: 3 }, frameId: 0 });
    expect(browser.badges.size).toBe(0);
  });
});

describe("a browser missing the optional APIs", () => {
  it("starts anyway rather than throwing", () => {
    const minimal = createFakeBrowser();
    delete (minimal as { commands?: unknown }).commands;
    delete (minimal as { action?: unknown }).action;
    delete (minimal as { tabs?: unknown }).tabs;
    expect(() => startBackground(minimal)).not.toThrow();
    expect(() =>
      minimal.deliverMessage({ type: "speed-changed", speed: 2 }, { tab: { id: 1 } }),
    ).not.toThrow();
  });
});
