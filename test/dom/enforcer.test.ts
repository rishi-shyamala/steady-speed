// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ESCALATION_CONFIG, type EscalationConfig, type Tier } from "../../src/core/escalation";
import { Enforcer, type EnforcerOptions } from "../../src/content/enforcer";
import { MediaRegistry } from "../../src/content/registry";
import { createMedia, instrumentMedia } from "../helpers/fake-media";

let registry: MediaRegistry;
let clock: number;
let target: { speed: number; preservePitch: boolean };
let tiers: Tier[];

const config = (overrides: Partial<EscalationConfig> = {}): EscalationConfig => ({
  ...DEFAULT_ESCALATION_CONFIG,
  ...overrides,
});

function build(overrides: Partial<EnforcerOptions> = {}): Enforcer {
  return new Enforcer({
    registry,
    getTarget: () => target,
    now: () => clock,
    onTierChange: (tier) => tiers.push(tier),
    ...overrides,
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  registry = new MediaRegistry();
  clock = 0;
  target = { speed: 2, preservePitch: true };
  tiers = [];
});

describe("apply", () => {
  it("sets the rate", () => {
    const media = createMedia();
    build().apply(media);
    expect(media.playbackRate).toBe(2);
  });

  it("sets the default rate too, because some players read it back", () => {
    const media = createMedia();
    media.defaultPlaybackRate = 1;
    build().apply(media);
    expect(media.defaultPlaybackRate).toBe(2);
  });

  it("keeps pitch preserved so speech stays intelligible", () => {
    const media = createMedia();
    media.preservesPitch = false;
    build().apply(media);
    expect(media.preservesPitch).toBe(true);

    target = { speed: 2, preservePitch: false };
    build().apply(media);
    expect(media.preservesPitch).toBe(false);
  });

  it("writes nothing when the element is already at the target", () => {
    const media = instrumentMedia(createMedia());
    const enforcer = build();
    enforcer.apply(media.element);
    enforcer.apply(media.element);
    enforcer.apply(media.element);
    expect(media.writes).toEqual([2]);
  });

  it("survives an element with no pitch or default-rate support", () => {
    const media = createMedia();
    Object.defineProperty(media, "preservesPitch", { value: undefined, configurable: true });
    Object.defineProperty(media, "defaultPlaybackRate", { value: undefined, configurable: true });
    expect(() => build().apply(media)).not.toThrow();
    expect(media.playbackRate).toBe(2);
  });

  it("applies to everything the registry knows about", () => {
    const first = createMedia();
    const second = createMedia("audio");
    registry.addMedia(first);
    registry.addMedia(second);
    build().applyAll();
    expect([first.playbackRate, second.playbackRate]).toEqual([2, 2]);
  });
});

describe("media events", () => {
  it("re-applies on an ordinary media event", () => {
    const media = createMedia();
    media.playbackRate = 1;
    build().handleEvent(media, "play");
    expect(media.playbackRate).toBe(2);
  });

  it("treats a rate change that matches the target as nothing to see", () => {
    const media = createMedia();
    media.playbackRate = 2;
    const enforcer = build();
    enforcer.handleEvent(media, "ratechange");
    expect(enforcer.tier).toBe(0);
    expect(tiers).toEqual([]);
  });

  it("escalates and corrects the first time a site changes the rate under us", () => {
    const media = createMedia();
    media.playbackRate = 1;
    const enforcer = build();
    enforcer.handleEvent(media, "ratechange");
    expect(enforcer.tier).toBe(1);
    expect(tiers).toEqual([1]);
    expect(media.playbackRate).toBe(2);
  });

  it("does not fight back when auto-escalation is switched off", () => {
    const media = createMedia();
    media.playbackRate = 1;
    const enforcer = build({ config: config({ autoEscalate: false }) });
    enforcer.handleEvent(media, "ratechange");
    expect(enforcer.tier).toBe(0);
    expect(media.playbackRate).toBe(1);
  });

  it("climbs to the reconcile tier when a site keeps at it", () => {
    const media = createMedia();
    const enforcer = build();
    for (let i = 0; i < 4; i += 1) {
      clock += 10;
      media.playbackRate = 1;
      enforcer.handleEvent(media, "ratechange");
    }
    expect(enforcer.tier).toBe(2);
  });
});

describe("loop protection", () => {
  /** Wires the element's own ratechange back into the enforcer, so a page that
   *  re-asserts its rate produces a real ping-pong rather than a single write. */
  function wire(enforcer: Enforcer, element: HTMLMediaElement): void {
    element.addEventListener("ratechange", () => {
      clock += 1;
      enforcer.handleEvent(element, "ratechange");
    });
  }

  it("stops re-applying against a player that re-asserts on every change", () => {
    const media = instrumentMedia(createMedia());
    const enforcer = build({ reapplyLimit: 3, reapplyWindowMs: 1000, cooldownMs: 500 });
    wire(enforcer, media.element);
    media.fightBackTo(1);

    media.element.dispatchEvent(new Event("ratechange"));

    // Exactly `reapplyLimit` attempts, then it gives up rather than spinning.
    expect(media.writes).toHaveLength(3);
    expect(media.element.playbackRate).toBe(1);
  });

  it("ignores further changes while it is backing off", () => {
    const media = instrumentMedia(createMedia());
    const enforcer = build({ reapplyLimit: 2, reapplyWindowMs: 1000, cooldownMs: 5000 });
    wire(enforcer, media.element);
    media.fightBackTo(1);
    media.element.dispatchEvent(new Event("ratechange"));
    const during = media.writes.length;

    clock += 10;
    enforcer.handleEvent(media.element, "ratechange");
    expect(media.writes).toHaveLength(during);
  });

  it("tries again once the cooldown has passed", () => {
    const media = instrumentMedia(createMedia());
    const enforcer = build({ reapplyLimit: 2, reapplyWindowMs: 1000, cooldownMs: 500 });
    wire(enforcer, media.element);
    media.fightBackTo(1);
    media.element.dispatchEvent(new Event("ratechange"));
    const during = media.writes.length;

    media.fightBackTo(null);
    clock += 600;
    media.element.dispatchEvent(new Event("ratechange"));

    expect(media.writes.length).toBeGreaterThan(during);
    expect(media.element.playbackRate).toBe(2);
  });

  it("keeps each element's budget separate", () => {
    const first = instrumentMedia(createMedia());
    const second = instrumentMedia(createMedia());
    const enforcer = build({ reapplyLimit: 2, reapplyWindowMs: 1000, cooldownMs: 500 });
    wire(enforcer, first.element);
    first.fightBackTo(1);
    first.element.dispatchEvent(new Event("ratechange"));

    second.element.playbackRate = 1;
    second.writes.length = 0;
    enforcer.handleEvent(second.element, "ratechange");
    expect(second.element.playbackRate).toBe(2);
  });
});

describe("defaults", () => {
  it("works with no clock or tier callback supplied", () => {
    const media = createMedia();
    media.playbackRate = 1;
    const enforcer = new Enforcer({ registry, getTarget: () => target });
    enforcer.handleEvent(media, "ratechange");
    expect(enforcer.tier).toBe(1);
    expect(media.playbackRate).toBe(2);
  });
});

describe("reconcile", () => {
  it("reports nothing to do when everything is at the target", () => {
    const media = createMedia();
    media.playbackRate = 2;
    registry.addMedia(media);
    expect(build().reconcile()).toBe(false);
  });

  it("corrects drift the events never told us about", () => {
    const media = createMedia();
    media.playbackRate = 1;
    registry.addMedia(media);
    const enforcer = build({ initialTier: 2 });
    expect(enforcer.reconcile()).toBe(true);
    expect(media.playbackRate).toBe(2);
  });

  it("lets the tier fall back after a quiet stretch", () => {
    const media = createMedia();
    media.playbackRate = 2;
    registry.addMedia(media);
    const enforcer = build({ initialTier: 2, config: config({ calmMs: 1000 }) });

    clock += 1500;
    enforcer.reconcile();
    expect(enforcer.tier).toBe(1);
    expect(tiers).toEqual([1]);
  });
});

describe("setTier", () => {
  it("restores a tier learned on an earlier visit", () => {
    const enforcer = build();
    enforcer.setTier(3);
    expect(enforcer.tier).toBe(3);
    expect(tiers).toEqual([3]);
  });

  it("does nothing when the tier is already right", () => {
    const enforcer = build({ initialTier: 2 });
    enforcer.setTier(2);
    expect(tiers).toEqual([]);
  });
});

describe("target changes", () => {
  it("reads the target afresh, so a settings change lands immediately", () => {
    const media = createMedia();
    const enforcer = build();
    enforcer.apply(media);
    expect(media.playbackRate).toBe(2);

    target = { speed: 1.5, preservePitch: true };
    enforcer.apply(media);
    expect(media.playbackRate).toBe(1.5);
  });
});

describe("wiring to discovery", () => {
  it("uses the same listeners discovery already installed", async () => {
    const { startDiscovery } = await import("../../src/content/discovery");
    const enforcer = build();
    const stop = startDiscovery({
      document,
      registry,
      onMedia: (media) => enforcer.apply(media),
      onEvent: (media, type) => enforcer.handleEvent(media, type),
      scheduleIdle: (task) => task(),
    });

    const media = createMedia();
    media.playbackRate = 1;
    media.dispatchEvent(new Event("play"));
    expect(media.playbackRate).toBe(2);

    const spy = vi.spyOn(enforcer, "handleEvent");
    media.dispatchEvent(new Event("ratechange"));
    expect(spy).toHaveBeenCalledWith(media, "ratechange");
    stop();
  });
});
