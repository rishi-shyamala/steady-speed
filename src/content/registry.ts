/**
 * What this frame knows about: the media elements it has found, and the event
 * roots it has attached listeners to.
 *
 * Both are held weakly. A single-page app can churn through thousands of media
 * elements without a navigation, and a content script that keeps them alive is
 * a memory leak the user never gets back.
 */

import { IterableWeakSet, type MakeWeakRef } from "../core/weak-set";

/** Anywhere media events can be caught in the capture phase. */
export type EventRoot = Document | ShadowRoot;

export class MediaRegistry {
  private readonly mediaSet: IterableWeakSet<HTMLMediaElement>;
  private readonly rootSet: IterableWeakSet<EventRoot>;

  constructor(makeRef?: MakeWeakRef) {
    this.mediaSet = new IterableWeakSet<HTMLMediaElement>(makeRef);
    this.rootSet = new IterableWeakSet<EventRoot>(makeRef);
  }

  /** True when this element had not been seen before. */
  addMedia(media: HTMLMediaElement): boolean {
    return this.mediaSet.add(media);
  }

  hasMedia(media: HTMLMediaElement): boolean {
    return this.mediaSet.has(media);
  }

  forEachMedia(visit: (media: HTMLMediaElement) => void): void {
    this.mediaSet.forEach(visit);
  }

  get mediaCount(): number {
    return this.mediaSet.size;
  }

  /** True when this root had not been attached to before. */
  addRoot(root: EventRoot): boolean {
    return this.rootSet.add(root);
  }

  hasRoot(root: EventRoot): boolean {
    return this.rootSet.has(root);
  }

  forEachRoot(visit: (root: EventRoot) => void): void {
    this.rootSet.forEach(visit);
  }

  clear(): void {
    this.mediaSet.clear();
    this.rootSet.clear();
  }
}
