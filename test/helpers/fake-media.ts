/**
 * happy-dom gives `playbackRate` no accessor and no `ratechange` event, so a
 * test cannot see who wrote what. This wraps a real element with an
 * instrumented rate, and can play the part of a site that fights back.
 */

export interface InstrumentedMedia {
  readonly element: HTMLVideoElement;
  /** Every value written to playbackRate, in order. */
  readonly writes: number[];
  /**
   * Makes the element snap back to `value` and fire `ratechange` whenever
   * anything writes a different rate — the behaviour of a player that
   * re-asserts its own speed. Pass null to stop.
   */
  fightBackTo(value: number | null): void;
}

export function instrumentMedia(element: HTMLVideoElement): InstrumentedMedia {
  const writes: number[] = [];
  let rate = 1;
  let fightTo: number | null = null;

  Object.defineProperty(element, "playbackRate", {
    configurable: true,
    get: () => rate,
    set: (value: number) => {
      writes.push(value);
      if (fightTo !== null && value !== fightTo) {
        rate = fightTo;
        element.dispatchEvent(new Event("ratechange"));
        return;
      }
      rate = value;
    },
  });

  return {
    element,
    writes,
    fightBackTo(value) {
      fightTo = value;
    },
  };
}

/** A media element whose rate can be read and written without instrumentation. */
export function createMedia(tag: "video" | "audio" = "video"): HTMLVideoElement {
  const element = document.createElement(tag) as HTMLVideoElement;
  document.body.append(element);
  return element;
}
