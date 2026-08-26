// @vitest-environment happy-dom
/**
 * Hostile pages.
 *
 * Each fixture reproduces one way a real player takes the playback rate back,
 * and asserts the lowest rung of the enforcement ladder that beats it. This is
 * what turns "how hard should it fight?" into something measured rather than
 * guessed. The page-world rung cannot be exercised from an isolated-world test,
 * so the fixtures it exists for assert escalation and bounded effort instead.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Tier } from "../../src/core/escalation";
import { startDiscovery } from "../../src/content/discovery";
import { Enforcer } from "../../src/content/enforcer";
import { MediaRegistry } from "../../src/content/registry";
import { Reconciler } from "../../src/content/reconciler";
import { createMedia, instrumentMedia } from "../helpers/fake-media";

const TARGET = 2;

interface Stack {
  readonly registry: MediaRegistry;
  readonly enforcer: Enforcer;
  readonly reconciler: Reconciler;
  readonly tier: Tier;
  advance(ms: number): void;
  runReconciles(times: number): void;
  flushIdle(): void;
  stop(): void;
}

function createStack(doc: Document = document): Stack {
  const registry = new MediaRegistry();
  let clock = 0;
  let idleTasks: (() => void)[] = [];
  let timerTask: (() => void) | null = null;
  let reconciler: Reconciler;

  const enforcer = new Enforcer({
    registry,
    getTarget: () => ({ speed: TARGET, preservePitch: true }),
    now: () => clock,
    onTierChange: (tier) => reconciler.setTier(tier),
    onDivergence: () => reconciler.wake(),
    reapplyLimit: 3,
    reapplyWindowMs: 1_000,
    cooldownMs: 100,
  });

  reconciler = new Reconciler({
    source: enforcer,
    cleanTicksBeforeStop: 2,
    setTimer: (task) => {
      timerTask = task;
      return 1;
    },
    clearTimer: () => {
      timerTask = null;
    },
  });

  const stopDiscovery = startDiscovery({
    document: doc,
    registry,
    onMedia: (media) => enforcer.apply(media),
    onEvent: (media, type) => enforcer.handleEvent(media, type),
    scheduleIdle: (task) => idleTasks.push(task),
  });

  return {
    registry,
    enforcer,
    reconciler,
    get tier() {
      return enforcer.tier;
    },
    advance(ms) {
      clock += ms;
    },
    runReconciles(times) {
      for (let i = 0; i < times; i += 1) {
        clock += 1_000;
        timerTask?.();
      }
    },
    flushIdle() {
      const queued = idleTasks;
      idleTasks = [];
      for (const task of queued) task();
    },
    stop: stopDiscovery,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let stack: Stack | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  stack = null;
});

afterEach(() => {
  stack?.stop();
});

describe("well-behaved pages stay free", () => {
  it("a plain video needs nothing above tier 0", () => {
    const media = createMedia();
    stack = createStack();
    expect(media.playbackRate).toBe(TARGET);
    expect(stack.tier).toBe(0);
    expect(stack.reconciler.running).toBe(false);
  });

  it("a video added later needs nothing above tier 0", async () => {
    stack = createStack();
    const media = createMedia();
    await tick();
    stack.flushIdle();
    expect(media.playbackRate).toBe(TARGET);
    expect(stack.tier).toBe(0);
  });

  it("media two shadow roots deep needs nothing above tier 0", () => {
    const outerHost = document.createElement("div");
    document.body.append(outerHost);
    const outer = outerHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    outer.append(innerHost);
    const inner = innerHost.attachShadow({ mode: "open" });
    const media = document.createElement("video");
    inner.append(media);

    stack = createStack();
    expect(media.playbackRate).toBe(TARGET);
    expect(stack.tier).toBe(0);
  });

  it("a source switch mid-playback is handled at tier 0", () => {
    const media = createMedia();
    stack = createStack();

    // The player swaps source: rate goes back to 1 and metadata reloads.
    media.playbackRate = 1;
    media.dispatchEvent(new Event("loadedmetadata"));
    expect(media.playbackRate).toBe(TARGET);
    expect(stack.tier).toBe(0);
  });
});

describe("players that take the rate back", () => {
  it("reset-on-play is beaten at tier 1", () => {
    const media = createMedia();
    stack = createStack();
    media.addEventListener("play", () => {
      media.playbackRate = 1;
      media.dispatchEvent(new Event("ratechange"));
    });

    media.dispatchEvent(new Event("play"));
    expect(media.playbackRate).toBe(TARGET);
    expect(stack.tier).toBe(1);
  });

  it("reset-on-seek is beaten at tier 1", () => {
    const media = createMedia();
    stack = createStack();
    media.addEventListener("seeked", () => {
      media.playbackRate = 1;
      media.dispatchEvent(new Event("ratechange"));
    });

    media.dispatchEvent(new Event("seeked"));
    expect(media.playbackRate).toBe(TARGET);
    expect(stack.tier).toBe(1);
  });

  it("a silent reset that fires no event needs the tier-2 reconcile", () => {
    const media = createMedia();
    stack = createStack();
    expect(media.playbackRate).toBe(TARGET);

    // A player that writes the rate without the element reporting it.
    media.playbackRate = 1;
    expect(stack.tier).toBe(0);

    stack.enforcer.setTier(2);
    stack.runReconciles(1);
    expect(media.playbackRate).toBe(TARGET);
  });

  it("the reconcile stands down once the player gives up", () => {
    const media = createMedia();
    stack = createStack();
    stack.enforcer.setTier(2);
    expect(stack.reconciler.running).toBe(true);

    media.playbackRate = TARGET;
    stack.runReconciles(2);
    expect(stack.reconciler.running).toBe(false);
  });
});

describe("players that cannot be beaten from the isolated world", () => {
  it("a ratechange rewrite loop is bounded, and climbs the ladder", () => {
    const media = instrumentMedia(createMedia());
    stack = createStack();
    expect(media.element.playbackRate).toBe(TARGET);

    // The player knocks the rate down, then re-asserts it on every change we
    // make. Discovery's own capture listener feeds each one back to us, so this
    // is a real ping-pong, not a scripted one.
    media.element.playbackRate = 1;
    media.writes.length = 0;
    media.fightBackTo(1);
    media.element.dispatchEvent(new Event("ratechange"));

    expect(media.writes).toHaveLength(3);
    expect(stack.tier).toBeGreaterThanOrEqual(1);
    expect(media.element.playbackRate).toBe(1);
  });

  it("a locked playbackRate property escalates to the page-world rung", () => {
    const media = createMedia();
    stack = createStack();
    // The page pins the rate: our writes are accepted and discarded.
    Object.defineProperty(media, "playbackRate", {
      configurable: true,
      get: () => 1,
      set: () => {},
    });

    for (let i = 0; i < 8; i += 1) {
      stack.advance(10);
      media.dispatchEvent(new Event("ratechange"));
    }

    expect(stack.tier).toBe(3);
  });

  it("stops at the reconcile rung when page-world injection is not allowed", () => {
    const media = createMedia();
    const registry = new MediaRegistry();
    let clock = 0;
    const enforcer = new Enforcer({
      registry,
      getTarget: () => ({ speed: TARGET, preservePitch: true }),
      now: () => clock,
      config: {
        autoEscalate: true,
        allowPageWorld: false,
        climbThreshold: 3,
        windowMs: 5_000,
        calmMs: 30_000,
      },
    });
    registry.addMedia(media);
    Object.defineProperty(media, "playbackRate", {
      configurable: true,
      get: () => 1,
      set: () => {},
    });

    for (let i = 0; i < 20; i += 1) {
      clock += 10;
      enforcer.handleEvent(media, "ratechange");
    }
    expect(enforcer.tier).toBe(2);
  });
});

describe("awkward places media hides", () => {
  it("media created detached and played is caught once it is attached", async () => {
    stack = createStack();
    const media = document.createElement("video");
    media.dispatchEvent(new Event("play"));
    expect(media.playbackRate).toBe(1);

    document.body.append(media);
    await tick();
    stack.flushIdle();
    expect(media.playbackRate).toBe(TARGET);
  });

  it("a same-origin iframe is handled by its own instance, as it is in the browser", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument;
    expect(inner).not.toBeNull();
    if (!inner) return;

    const media = inner.createElement("video");
    inner.body.append(media);

    const innerStack = createStack(inner);
    try {
      expect(media.playbackRate).toBe(TARGET);
      expect(innerStack.tier).toBe(0);
    } finally {
      innerStack.stop();
    }
  });
});
