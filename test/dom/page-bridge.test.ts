// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageBridge, type PageBridgeOptions } from "../../src/content/page-bridge";
import {
  commandEventName,
  dispatchPayload,
  messageEventName,
  readPayload,
} from "../../src/page/protocol";

const KEY = "bridgekey";
const TARGET = { speed: 2, preservePitch: true };

let timers: { task: () => void; ms: number }[];
let commands: unknown[];
let unavailable: string[];

let bridges: PageBridge[];

function build(overrides: Partial<PageBridgeOptions> = {}): PageBridge {
  const bridge = new PageBridge({
    document,
    getUrl: (path) => `moz-extension://fake/${path}`,
    key: KEY,
    setTimer: (task, ms) => {
      timers.push({ task, ms });
      return timers.length;
    },
    clearTimer: (id) => {
      timers.splice(id - 1, 1, { task: () => {}, ms: 0 });
    },
    onUnavailable: (reason) => unavailable.push(reason),
    ...overrides,
  });
  bridges.push(bridge);
  return bridge;
}

/** Stands in for the agent announcing itself from the page's world. */
function agentAnnounces(): void {
  dispatchPayload(document, messageEventName(KEY), { type: "ready" });
}

/**
 * happy-dom tries to fetch any `<script src>` the moment it is appended and
 * fires a synchronous `error` when it cannot — which the bridge would rightly
 * read as "the page blocked us". Real browsers load an extension URL fine and
 * report a CSP block asynchronously, so the loader is stubbed out here and the
 * failure paths are driven explicitly instead.
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
let collectCommands: (event: Event) => void;

function injectedScript(): HTMLScriptElement | null {
  return document.querySelector("script[data-steady-key]");
}

beforeEach(() => {
  restoreScriptLoading = stubScriptLoading();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  // The bridge appends to documentElement, which survives clearing head/body.
  for (const stale of document.querySelectorAll("script[data-steady-key]")) stale.remove();
  timers = [];
  bridges = [];
  commands = [];
  unavailable = [];
  collectCommands = (event: Event) => commands.push(readPayload(event));
  document.addEventListener(commandEventName(KEY), collectCommands);
});

afterEach(() => {
  for (const bridge of bridges) bridge.dispose();
  document.removeEventListener(commandEventName(KEY), collectCommands);
  restoreScriptLoading();
});

describe("injection", () => {
  it("does nothing until it is activated", () => {
    const bridge = build();
    expect(bridge.state).toBe("idle");
    expect(injectedScript()).toBeNull();
  });

  it("injects the agent from the extension's own URL", () => {
    build().activate(TARGET);
    const script = injectedScript();
    expect(script?.src).toBe("moz-extension://fake/page-agent.js");
    expect(script?.dataset.steadyKey).toBe(KEY);
  });

  it("injects only once however often it is activated", () => {
    const bridge = build();
    bridge.activate(TARGET);
    bridge.activate({ speed: 3, preservePitch: true });
    expect(document.querySelectorAll("script[data-steady-key]")).toHaveLength(1);
  });

  it("cleans the script tag out of the page once it has run", () => {
    build().activate(TARGET);
    const script = injectedScript();
    script?.dispatchEvent(new Event("load"));
    expect(injectedScript()).toBeNull();
  });
});

describe("handshake", () => {
  it("sends the target once the agent answers", () => {
    const bridge = build();
    bridge.activate(TARGET);
    expect(commands).toEqual([]);

    agentAnnounces();
    expect(bridge.state).toBe("ready");
    expect(commands).toEqual([{ type: "target", speed: 2, preservePitch: true }]);
  });

  it("sends later targets straight through", () => {
    const bridge = build();
    bridge.activate(TARGET);
    agentAnnounces();
    bridge.activate({ speed: 3, preservePitch: false });
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual({ type: "target", speed: 3, preservePitch: false });
  });

  it("ignores a second announcement", () => {
    const bridge = build();
    bridge.activate(TARGET);
    agentAnnounces();
    agentAnnounces();
    expect(commands).toHaveLength(1);
  });

  it("ignores messages it cannot read", () => {
    const bridge = build();
    bridge.activate(TARGET);
    document.dispatchEvent(new CustomEvent(messageEventName(KEY), { detail: "{oops" }));
    expect(bridge.state).toBe("injecting");
  });
});

describe("when the page will not have it", () => {
  it("gives up loudly if the agent never answers", () => {
    const bridge = build({ handshakeMs: 1500 });
    bridge.activate(TARGET);
    expect(timers[0]?.ms).toBe(1500);

    timers[0]?.task();
    expect(bridge.state).toBe("unavailable");
    expect(unavailable).toEqual(["the page blocked the agent"]);
  });

  it("gives up when the script itself fails to load", () => {
    const bridge = build();
    bridge.activate(TARGET);
    injectedScript()?.dispatchEvent(new Event("error"));
    expect(bridge.state).toBe("unavailable");
    expect(unavailable).toEqual(["the agent script failed to load"]);
  });

  it("reports only once", () => {
    const bridge = build();
    bridge.activate(TARGET);
    const script = injectedScript();
    script?.dispatchEvent(new Event("error"));
    script?.dispatchEvent(new Event("error"));
    timers[0]?.task();
    expect(bridge.state).toBe("unavailable");
    expect(unavailable).toHaveLength(1);
  });

  it("does not report after a successful handshake", () => {
    const bridge = build();
    bridge.activate(TARGET);
    agentAnnounces();
    timers[0]?.task();
    expect(unavailable).toEqual([]);
    expect(bridge.state).toBe("ready");
  });

  it("stays quiet when activated again after failing", () => {
    const bridge = build();
    bridge.activate(TARGET);
    injectedScript()?.dispatchEvent(new Event("error"));
    bridge.activate(TARGET);
    expect(commands).toEqual([]);
    expect(document.querySelectorAll("script[data-steady-key]")).toHaveLength(1);
  });
});

describe("deactivate", () => {
  it("tells a ready agent to stand down", () => {
    const bridge = build();
    bridge.activate(TARGET);
    agentAnnounces();
    bridge.deactivate();
    expect(commands[1]).toEqual({ type: "stop" });
  });

  it("is quiet when no agent is ready", () => {
    const bridge = build();
    bridge.deactivate();
    expect(commands).toEqual([]);
  });

  it("does not resend a stale target after standing down", () => {
    const bridge = build();
    bridge.activate(TARGET);
    bridge.deactivate();
    agentAnnounces();
    expect(commands).toEqual([]);
  });
});

describe("defaults", () => {
  it("generates its own key and uses real timers", () => {
    vi.useFakeTimers();
    try {
      const reasons: string[] = [];
      const bridge = new PageBridge({
        document,
        getUrl: (path) => `moz-extension://fake/${path}`,
        handshakeMs: 50,
        onUnavailable: (reason) => reasons.push(reason),
      });
      bridges.push(bridge);
      bridge.activate(TARGET);
      const key = injectedScript()?.dataset.steadyKey ?? "";
      expect(key).toMatch(/^[0-9a-f]{32}$/);

      vi.advanceTimersByTime(100);
      expect(reasons).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays silent about failure when no handler was given", () => {
    vi.useFakeTimers();
    try {
      const bridge = new PageBridge({
        document,
        getUrl: (path) => `moz-extension://fake/${path}`,
        handshakeMs: 10,
      });
      bridges.push(bridge);
      bridge.activate(TARGET);
      expect(() => vi.advanceTimersByTime(50)).not.toThrow();
      expect(bridge.state).toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });
});
