/**
 * Finding the media on a page, cheaply.
 *
 * Three mechanisms, in increasing cost, and none of them a recursive DOM crawl
 * on a timer:
 *
 *   D0  Capturing listeners on each known event root. Media events do not
 *       bubble, but the capture phase still reaches them, so every element in
 *       the light DOM announces itself the moment it does anything.
 *   D1  One sweep at start plus a MutationObserver that only inspects the nodes
 *       actually added, batched through an idle callback.
 *   D2  Open shadow roots, which media events cannot escape (they are
 *       composed: false). Found by crawling for shadow hosts during a sweep and
 *       by following focus into a root when the user interacts with one.
 */

import type { MediaRegistry, EventRoot } from "./registry";

/** Events that mean "this element exists and is doing something". */
export const MEDIA_EVENTS = [
  "loadedmetadata",
  "play",
  "playing",
  "canplay",
  "durationchange",
  "ratechange",
] as const;

const MEDIA_SELECTOR = "video,audio";

/** Default ceiling on the shadow-host crawl, so a huge page cannot stall a sweep. */
export const MAX_CRAWL_NODES = 4000;

const CAPTURE: AddEventListenerOptions = { capture: true, passive: true };

export type ScheduleIdle = (task: () => void) => void;

export interface DiscoveryOptions {
  document: Document;
  registry: MediaRegistry;
  /** Called once per element, the first time it is seen. */
  onMedia: (media: HTMLMediaElement) => void;
  /**
   * Called for every media event on every known root. Enforcement rides on the
   * same listeners as discovery so the page only ever carries one set.
   */
  onEvent?: ((media: HTMLMediaElement, type: string) => void) | undefined;
  /** Injectable so tests can flush deterministically. */
  scheduleIdle?: ScheduleIdle | undefined;
  /** Ceiling on the shadow-host crawl. Lower it to profile pathological pages. */
  maxCrawlNodes?: number | undefined;
}

/** Starts discovery for one frame. Returns a function that stops it. */
export function startDiscovery(options: DiscoveryOptions): () => void {
  const { document: doc, registry, onMedia } = options;
  const onEvent = options.onEvent;
  const schedule = options.scheduleIdle ?? defaultScheduleIdle;
  const maxCrawlNodes = options.maxCrawlNodes ?? MAX_CRAWL_NODES;

  const attachedRoots: EventRoot[] = [];
  let pending: Node[] = [];
  let flushScheduled = false;
  let stopped = false;

  const register = (media: HTMLMediaElement): void => {
    if (!registry.addMedia(media)) return;
    const root = media.getRootNode();
    if (isShadowRoot(root)) attachRoot(root);
    onMedia(media);
  };

  const handleMediaEvent = (event: Event): void => {
    const target = event.target;
    if (!isMedia(target)) return;
    register(target);
    onEvent?.(target, event.type);
  };

  const handleFocus = (event: Event): void => {
    // Focus inside a shadow root retargets to its host out here, which is how
    // an isolated content script gets a reference to the root at all.
    followShadowChain(event.target, attachRoot, sweep);
  };

  const attachRoot = (root: EventRoot): void => {
    if (stopped || !registry.addRoot(root)) return;
    attachedRoots.push(root);
    for (const type of MEDIA_EVENTS) root.addEventListener(type, handleMediaEvent, CAPTURE);
  };

  const sweep = (scope: ParentNode): void => {
    for (const element of scope.querySelectorAll(MEDIA_SELECTOR)) {
      if (isMedia(element)) register(element);
    }
    crawlShadowHosts(scope, maxCrawlNodes, (shadow) => {
      attachRoot(shadow);
      sweep(shadow);
    });
  };

  const flush = (): void => {
    flushScheduled = false;
    const nodes = pending;
    pending = [];
    if (stopped) return;
    for (const node of nodes) {
      if (isMedia(node)) register(node);
      else if (node instanceof Element) sweep(node);
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) pending.push(node);
    }
    if (pending.length === 0 || flushScheduled) return;
    flushScheduled = true;
    schedule(flush);
  });

  attachRoot(doc);
  doc.addEventListener("focusin", handleFocus, CAPTURE);
  sweep(doc);
  observer.observe(doc, { childList: true, subtree: true });

  return () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    doc.removeEventListener("focusin", handleFocus, CAPTURE);
    for (const root of attachedRoots) {
      for (const type of MEDIA_EVENTS) root.removeEventListener(type, handleMediaEvent, CAPTURE);
    }
    attachedRoots.length = 0;
  };
}

/** Visits every open shadow root under `scope`, up to the crawl ceiling. */
function crawlShadowHosts(
  scope: ParentNode,
  maxNodes: number,
  visit: (shadow: ShadowRoot) => void,
): void {
  let budget = maxNodes;
  for (const element of scope.querySelectorAll("*")) {
    if (budget-- <= 0) return;
    const shadow = element.shadowRoot;
    if (shadow) visit(shadow);
  }
}

/** Walks host -> shadow root -> host -> ... from a focus target. */
function followShadowChain(
  target: EventTarget | null,
  onRoot: (shadow: ShadowRoot) => void,
  onScope: (scope: ParentNode) => void,
): void {
  let node: Element | null = target instanceof Element ? target : null;
  while (node) {
    const shadow: ShadowRoot | null = node.shadowRoot;
    if (!shadow) return;
    onRoot(shadow);
    onScope(shadow);
    node = shadow.activeElement;
  }
}

function isMedia(value: unknown): value is HTMLMediaElement {
  return value instanceof HTMLMediaElement;
}

function isShadowRoot(value: unknown): value is ShadowRoot {
  return typeof ShadowRoot !== "undefined" && value instanceof ShadowRoot;
}

const defaultScheduleIdle: ScheduleIdle = (task) => {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => void })
    .requestIdleCallback;
  if (idle) idle(task, { timeout: 250 });
  else setTimeout(task, 0);
};
