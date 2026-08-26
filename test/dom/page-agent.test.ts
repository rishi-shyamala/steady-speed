// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAgent, type AgentHandle } from "../../src/page/agent";
import {
  commandEventName,
  dispatchPayload,
  messageEventName,
  readPayload,
} from "../../src/page/protocol";

const KEY = "testkey";

let agent: AgentHandle | null = null;

function send(command: unknown): void {
  dispatchPayload(document, commandEventName(KEY), command);
}

function media(): HTMLVideoElement {
  const element = document.createElement("video");
  document.body.append(element);
  return element;
}

interface RateRig {
  restore(): void;
  /** What the element is really playing at, past the agent's interception. */
  actual(element: object, property: "playbackRate" | "defaultPlaybackRate"): number;
}

/** happy-dom's playbackRate is a plain data property; the agent needs an
 *  accessor to intercept, exactly as a real browser provides. */
function giveMediaRateAccessors(): RateRig {
  const prototype = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  const values = new WeakMap<object, { playbackRate: number; defaultPlaybackRate: number }>();
  const originals: Record<string, PropertyDescriptor | undefined> = {};

  for (const property of ["playbackRate", "defaultPlaybackRate"] as const) {
    originals[property] = Object.getOwnPropertyDescriptor(prototype, property);
    Object.defineProperty(prototype, property, {
      configurable: true,
      enumerable: true,
      get(this: object) {
        return values.get(this)?.[property] ?? 1;
      },
      set(this: object, value: number) {
        const current = values.get(this) ?? { playbackRate: 1, defaultPlaybackRate: 1 };
        current[property] = value;
        values.set(this, current);
      },
    });
  }

  return {
    restore() {
      for (const property of ["playbackRate", "defaultPlaybackRate"] as const) {
        const original = originals[property];
        if (original) Object.defineProperty(prototype, property, original);
        else delete prototype[property];
      }
    },
    actual(element, property) {
      return values.get(element)?.[property] ?? 1;
    },
  };
}

let rig: RateRig;

beforeEach(() => {
  document.body.innerHTML = "";
  rig = giveMediaRateAccessors();
});

afterEach(() => {
  agent?.deactivate();
  agent = null;
  rig.restore();
});

describe("handshake", () => {
  it("announces itself as soon as it is installed", () => {
    const announced: unknown[] = [];
    document.addEventListener(messageEventName(KEY), (event) => announced.push(readPayload(event)));
    agent = installAgent({ key: KEY });
    expect(announced).toEqual([{ type: "ready" }]);
  });
});

describe("before it is given a target", () => {
  it("leaves the page's own rate alone", () => {
    agent = installAgent({ key: KEY });
    const element = media();
    element.playbackRate = 1.5;
    expect(element.playbackRate).toBe(1.5);
  });
});

describe("with a target", () => {
  it("applies to media already on the page", () => {
    const element = media();
    agent = installAgent({ key: KEY });
    send({ type: "target", speed: 2, preservePitch: true });
    expect(element.playbackRate).toBe(2);
  });

  it("keeps playing at our speed when the page writes its own", () => {
    const element = media();
    agent = installAgent({ key: KEY });
    send({ type: "target", speed: 2, preservePitch: true });

    element.playbackRate = 1;
    expect(rig.actual(element, "playbackRate")).toBe(2);
  });

  it("hands the page back what it wrote, so a player that checks stops fighting", () => {
    const element = media();
    agent = installAgent({ key: KEY });
    send({ type: "target", speed: 2, preservePitch: true });

    element.playbackRate = 1;
    expect(element.playbackRate).toBe(1);
    expect(rig.actual(element, "playbackRate")).toBe(2);
  });

  it("covers defaultPlaybackRate as well, which players read back", () => {
    const element = media();
    agent = installAgent({ key: KEY });
    send({ type: "target", speed: 2, preservePitch: true });

    element.defaultPlaybackRate = 1;
    expect(element.defaultPlaybackRate).toBe(1);
    expect(rig.actual(element, "defaultPlaybackRate")).toBe(2);
  });

  it("catches media created after the target was set, when it plays", () => {
    agent = installAgent({ key: KEY });
    send({ type: "target", speed: 2, preservePitch: true });

    const element = media();
    element.play();
    expect(rig.actual(element, "playbackRate")).toBe(2);
  });

  it("catches media that reloads its source", () => {
    agent = installAgent({ key: KEY });
    send({ type: "target", speed: 2, preservePitch: true });

    const element = media();
    element.load();
    expect(rig.actual(element, "playbackRate")).toBe(2);
  });

  it("follows a target change", () => {
    const element = media();
    agent = installAgent({ key: KEY });
    send({ type: "target", speed: 2, preservePitch: true });
    send({ type: "target", speed: 3, preservePitch: true });
    expect(rig.actual(element, "playbackRate")).toBe(3);
  });

  it("preserves pitch as instructed", () => {
    const element = media();
    element.preservesPitch = false;
    agent = installAgent({ key: KEY });
    send({ type: "target", speed: 2, preservePitch: true });
    expect(element.preservesPitch).toBe(true);
  });
});

describe("before it is given a target, still", () => {
  it("notices a play but changes nothing", () => {
    agent = installAgent({ key: KEY });
    const element = media();
    expect(() => element.play()).not.toThrow();
    expect(rig.actual(element, "playbackRate")).toBe(1);
  });

  it("applies to media it noticed earlier when a target arrives", () => {
    agent = installAgent({ key: KEY });
    const element = media();
    element.play();
    element.remove();

    send({ type: "target", speed: 2, preservePitch: true });
    expect(rig.actual(element, "playbackRate")).toBe(2);
  });
});

describe("bootstrapping", () => {
  it("starts from the key on the injecting script tag", async () => {
    const { bootstrapFromScript } = await import("../../src/page/agent");
    const script = document.createElement("script");
    script.dataset.steadyKey = "frombootstrap";
    agent = bootstrapFromScript(script);
    expect(agent).not.toBeNull();

    dispatchPayload(document, commandEventName("frombootstrap"), {
      type: "target",
      speed: 2,
      preservePitch: true,
    });
    const element = media();
    element.play();
    expect(rig.actual(element, "playbackRate")).toBe(2);
  });

  it("does nothing without a key", async () => {
    const { bootstrapFromScript } = await import("../../src/page/agent");
    expect(bootstrapFromScript(null)).toBeNull();
    expect(bootstrapFromScript(document.createElement("script"))).toBeNull();
  });
});

describe("stopping", () => {
  it("hands control back on a stop command", () => {
    const element = media();
    agent = installAgent({ key: KEY });
    send({ type: "target", speed: 2, preservePitch: true });
    send({ type: "stop" });

    element.playbackRate = 1.5;
    expect(element.playbackRate).toBe(1.5);
  });

  it("restores the page's own properties on deactivate", () => {
    const before = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");
    agent = installAgent({ key: KEY });
    const during = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");
    agent.deactivate();
    agent = null;
    const after = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");

    expect(during?.get).not.toBe(before?.get);
    expect(after?.get).toBe(before?.get);
  });

  it("restores the methods it hooked", () => {
    const before = HTMLMediaElement.prototype.play;
    agent = installAgent({ key: KEY });
    expect(HTMLMediaElement.prototype.play).not.toBe(before);
    agent.deactivate();
    agent = null;
    expect(HTMLMediaElement.prototype.play).toBe(before);
  });

  it("stops listening to commands after deactivate", () => {
    const element = media();
    agent = installAgent({ key: KEY });
    agent.deactivate();
    agent = null;

    send({ type: "target", speed: 2, preservePitch: true });
    expect(element.playbackRate).toBe(1);
  });
});

describe("robustness", () => {
  it("ignores payloads it cannot read", () => {
    agent = installAgent({ key: KEY });
    expect(() => {
      document.dispatchEvent(new CustomEvent(commandEventName(KEY), { detail: "{oops" }));
      document.dispatchEvent(new CustomEvent(commandEventName(KEY), { detail: 42 }));
    }).not.toThrow();
  });

  it("keeps a hooked method's source text, which players fingerprint", () => {
    const before = HTMLMediaElement.prototype.play.toString();
    agent = installAgent({ key: KEY });
    expect(HTMLMediaElement.prototype.play.toString()).toBe(before);
  });

  it("does nothing at all if the rate properties are not accessors", () => {
    const prototype = {} as object;
    agent = installAgent({ key: KEY, mediaPrototype: prototype });
    expect(Object.getOwnPropertyDescriptor(prototype, "playbackRate")).toBeUndefined();
  });
});
