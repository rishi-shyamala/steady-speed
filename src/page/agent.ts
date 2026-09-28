/**
 * The page-world agent: the top rung of the enforcement ladder.
 *
 * Everything below this runs in the content script's isolated world, where a
 * write to `playbackRate` is just another write the page can undo. Here we own
 * the property itself, so a player that re-asserts its rate in a
 * requestAnimationFrame loop is writing into a value we hand back to it while
 * the element keeps playing at the speed you asked for.
 *
 * This is the largest surface area in the extension, which is why it is a
 * separate file, injected only when the ladder has already established that
 * nothing cheaper works, and why it does exactly two things: intercept the two
 * rate properties, and notice elements via `play`/`load`.
 */

import { IterableWeakSet } from "../core/weak-set";
import {
  commandEventName,
  dispatchPayload,
  messageEventName,
  readPayload,
  type AgentCommand,
} from "./protocol";

/** The rate properties a player can use to take the speed back. */
const RATE_PROPERTIES = ["playbackRate", "defaultPlaybackRate"] as const;
type RateProperty = (typeof RATE_PROPERTIES)[number];

export interface AgentHandle {
  /** Restores the page's own properties and stops listening. */
  deactivate(): void;
}

export interface AgentOptions {
  key: string;
  mediaPrototype?: object;
}

interface Intercepted {
  property: RateProperty;
  original: PropertyDescriptor;
  /** What the page believes it set, so reads stay coherent for its own UI. */
  pageValues: WeakMap<object, number>;
}

export function installAgent(options: AgentOptions): AgentHandle {
  const prototype = options.mediaPrototype ?? HTMLMediaElement.prototype;
  // Held weakly for the same reason as the content script's registry: an
  // `new Audio()` that was played once must not be pinned for the page's life.
  const known = new IterableWeakSet<HTMLMediaElement>();

  let target: { speed: number; preservePitch: boolean } | null = null;

  const intercepted = RATE_PROPERTIES.map((property) =>
    intercept(prototype, property, () => target?.speed ?? null),
  ).filter((entry): entry is Intercepted => entry !== null);

  const restorePlay = hookMethod(prototype, "play", (media) => remember(media));
  const restoreLoad = hookMethod(prototype, "load", (media) => remember(media));

  function remember(media: HTMLMediaElement): void {
    known.add(media);
    applyTo(media);
  }

  function applyTo(media: HTMLMediaElement): void {
    if (!target) return;
    for (const entry of intercepted) entry.original.set?.call(media, target.speed);
    if (typeof media.preservesPitch === "boolean") media.preservesPitch = target.preservePitch;
  }

  function applyToAll(): void {
    for (const media of known) applyTo(media);
    for (const media of document.querySelectorAll("video,audio")) {
      applyTo(media as HTMLMediaElement);
    }
  }

  const handleCommand = (event: Event): void => {
    const command = readPayload<AgentCommand>(event);
    if (!command) return;
    if (command.type === "target") {
      target = { speed: command.speed, preservePitch: command.preservePitch };
      applyToAll();
    } else if (command.type === "stop") {
      target = null;
    }
  };

  document.addEventListener(commandEventName(options.key), handleCommand);
  dispatchPayload(document, messageEventName(options.key), { type: "ready" });

  return {
    deactivate() {
      document.removeEventListener(commandEventName(options.key), handleCommand);
      target = null;
      for (const entry of intercepted) {
        Object.defineProperty(prototype, entry.property, entry.original);
      }
      restorePlay();
      restoreLoad();
      known.clear();
    },
  };
}

/**
 * Replaces a rate property so that the page's writes are remembered but not
 * obeyed, and its reads get back what it wrote. A player that checks its own
 * work sees what it expects and stops fighting.
 */
function intercept(
  prototype: object,
  property: RateProperty,
  getTargetSpeed: () => number | null,
): Intercepted | null {
  const original = Object.getOwnPropertyDescriptor(prototype, property);
  if (!original?.get || !original.set) return null;

  const pageValues = new WeakMap<object, number>();
  const nativeGet = original.get;
  const nativeSet = original.set;

  Object.defineProperty(prototype, property, {
    configurable: true,
    enumerable: true,
    get(this: object): number {
      const speed = getTargetSpeed();
      if (speed === null) return nativeGet.call(this) as number;
      const claimed = pageValues.get(this);
      return claimed === undefined ? (nativeGet.call(this) as number) : claimed;
    },
    set(this: object, value: number) {
      const speed = getTargetSpeed();
      if (speed === null) {
        nativeSet.call(this, value);
        return;
      }
      pageValues.set(this, value);
      nativeSet.call(this, speed);
    },
  });

  return { property, original, pageValues };
}

/** Wraps a prototype method so we notice the elements it is called on. */
function hookMethod(
  prototype: object,
  name: "play" | "load",
  onCall: (media: HTMLMediaElement) => void,
): () => void {
  const record = prototype as Record<string, unknown>;
  const original = record[name];
  if (typeof original !== "function") return () => {};

  const wrapper = function (this: HTMLMediaElement, ...args: unknown[]): unknown {
    const result = (original as (...a: unknown[]) => unknown).apply(this, args);
    onCall(this);
    return result;
  };
  // Some players fingerprint patched methods by their source text.
  wrapper.toString = () => (original as { toString(): string }).toString();
  record[name] = wrapper;

  return () => {
    record[name] = original;
  };
}

/** Starts the agent from the tag that injected it. Null when there is no key. */
export function bootstrapFromScript(script: HTMLScriptElement | null): AgentHandle | null {
  const key = script?.dataset.steadyKey;
  return key ? installAgent({ key }) : null;
}
