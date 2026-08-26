import { beforeEach, describe, expect, it, vi } from "vitest";
import { Reconciler, type ReconcilerOptions } from "../../src/content/reconciler";

/** A stand-in for setInterval that a test can step by hand. */
function createTimers() {
  let nextId = 1;
  const tasks = new Map<number, () => void>();
  return {
    setTimer: (task: () => void) => {
      const id = nextId++;
      tasks.set(id, task);
      return id;
    },
    clearTimer: (id: number) => void tasks.delete(id),
    get count() {
      return tasks.size;
    },
    step(times = 1) {
      for (let i = 0; i < times; i += 1) for (const task of [...tasks.values()]) task();
    },
  };
}

let timers: ReturnType<typeof createTimers>;
let drifted: boolean;
let reconcileCalls: number;

function build(overrides: Partial<ReconcilerOptions> = {}): Reconciler {
  return new Reconciler({
    source: {
      reconcile: () => {
        reconcileCalls += 1;
        return drifted;
      },
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    cleanTicksBeforeStop: 2,
    ...overrides,
  });
}

beforeEach(() => {
  timers = createTimers();
  drifted = true;
  reconcileCalls = 0;
});

describe("staying out of the way", () => {
  it("does nothing at all below the reconcile tier", () => {
    const reconciler = build();
    reconciler.setTier(0);
    reconciler.setTier(1);
    expect(reconciler.running).toBe(false);
    expect(timers.count).toBe(0);
  });

  it("starts only once the tier calls for it", () => {
    const reconciler = build();
    reconciler.setTier(2);
    expect(reconciler.running).toBe(true);
  });

  it("stops again when the tier falls back", () => {
    const reconciler = build();
    reconciler.setTier(2);
    reconciler.setTier(1);
    expect(reconciler.running).toBe(false);
    expect(timers.count).toBe(0);
  });

  it("never runs two timers at once", () => {
    const reconciler = build();
    reconciler.setTier(2);
    reconciler.setTier(3);
    reconciler.wake();
    expect(timers.count).toBe(1);
  });
});

describe("standing down", () => {
  it("keeps going while the site is still drifting", () => {
    const reconciler = build();
    reconciler.setTier(2);
    timers.step(5);
    expect(reconciler.running).toBe(true);
    expect(reconcileCalls).toBe(5);
  });

  it("stops itself once the page settles", () => {
    const reconciler = build();
    reconciler.setTier(2);
    drifted = false;
    timers.step(2);
    expect(reconciler.running).toBe(false);
  });

  it("counts clean ticks consecutively, not cumulatively", () => {
    const reconciler = build();
    reconciler.setTier(2);
    drifted = false;
    timers.step(1);
    drifted = true;
    timers.step(1);
    drifted = false;
    timers.step(1);
    expect(reconciler.running).toBe(true);
  });

  it("uses a default clean-tick budget when none is given", () => {
    const reconciler = build({ cleanTicksBeforeStop: undefined });
    reconciler.setTier(2);
    drifted = false;
    timers.step(4);
    expect(reconciler.running).toBe(true);
    timers.step(1);
    expect(reconciler.running).toBe(false);
  });

  it("comes back when the site misbehaves again", () => {
    const reconciler = build();
    reconciler.setTier(2);
    drifted = false;
    timers.step(2);
    expect(reconciler.running).toBe(false);

    drifted = true;
    reconciler.wake();
    expect(reconciler.running).toBe(true);
  });
});

describe("hidden tabs", () => {
  it("does no work while the page is hidden", () => {
    const reconciler = build();
    reconciler.setTier(2);
    reconciler.setVisible(false);
    expect(reconciler.running).toBe(false);
    expect(timers.count).toBe(0);
  });

  it("picks back up when the page is shown again", () => {
    const reconciler = build();
    reconciler.setTier(2);
    reconciler.setVisible(false);
    reconciler.setVisible(true);
    expect(reconciler.running).toBe(true);
  });

  it("stays idle on becoming visible if the tier no longer needs it", () => {
    const reconciler = build();
    reconciler.setTier(2);
    reconciler.setVisible(false);
    reconciler.setTier(0);
    reconciler.setVisible(true);
    expect(reconciler.running).toBe(false);
  });

  it("ignores a wake while hidden", () => {
    const reconciler = build();
    reconciler.setTier(2);
    reconciler.setVisible(false);
    reconciler.wake();
    expect(reconciler.running).toBe(false);
  });
});

describe("stop", () => {
  it("is safe to call when nothing is running", () => {
    const reconciler = build();
    expect(() => reconciler.stop()).not.toThrow();
  });
});

describe("real timers", () => {
  it("uses the browser's own interval when none is injected", () => {
    vi.useFakeTimers();
    try {
      const reconciler = build({ setTimer: undefined, clearTimer: undefined, intervalMs: 10 });
      reconciler.setTier(2);
      vi.advanceTimersByTime(35);
      expect(reconcileCalls).toBeGreaterThanOrEqual(3);
      reconciler.stop();
      const after = reconcileCalls;
      vi.advanceTimersByTime(50);
      expect(reconcileCalls).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });
});
