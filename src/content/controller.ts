/**
 * One frame's worth of wiring.
 *
 * The order here is the whole point of the design: settings are read straight
 * from storage rather than fetched from the background page, so the shortest
 * path from document_start to the right playback rate is a single storage read.
 * Everything else - discovery, enforcement, the reconcile net, the page-world
 * agent - hangs off that.
 */

import { needsPageWorld, type Tier } from "../core/escalation";
import { resolveSpeed } from "../core/rules";
import { DEFAULT_SETTINGS, type Settings } from "../core/settings";
import { NORMAL_SPEED, conformSpeed, speedsEqual, stepSpeed } from "../core/speed";
import {
  parseContentRequest,
  type ContentState,
  type CommandName,
} from "../platform/messages";
import { createSettingsStore, createTierStore } from "../platform/storage";
import { getBrowser, type WebExtensionApi } from "../platform/webext";
import { startDiscovery } from "./discovery";
import { Enforcer, type EnforcementTarget } from "./enforcer";
import { PageBridge } from "./page-bridge";
import { MediaRegistry } from "./registry";
import { Reconciler } from "./reconciler";

export interface ControllerOptions {
  window: Window & typeof globalThis;
  api?: WebExtensionApi | undefined;
}

export interface Controller {
  stop(): void;
  /** Resolves once settings and any learned tier have been read. */
  readonly ready: Promise<void>;
  /** Exposed for tests and the popup path; the same value the media gets. */
  readonly state: ContentState;
}

export function startController(options: ControllerOptions): Controller {
  const win = options.window;
  const doc = win.document;
  const api = options.api ?? getBrowser();
  const settingsStore = createSettingsStore(api);
  const tierStore = createTierStore(api);

  const registry = new MediaRegistry();
  let settings: Settings = { ...DEFAULT_SETTINGS, presets: [...DEFAULT_SETTINGS.presets], rules: [] };
  let override: number | null = null;
  let lastReported: number | null = null;

  const pageUrl = (): string => effectiveUrl(win.location.href, doc.referrer);
  const host = (): string => {
    try {
      return new URL(pageUrl()).hostname;
    } catch {
      return "";
    }
  };

  const ruleSpeed = (): number => resolveSpeed(pageUrl(), settings.rules, settings.defaultSpeed);
  const targetSpeed = (): number => override ?? ruleSpeed();
  const target = (): EnforcementTarget => ({
    speed: targetSpeed(),
    preservePitch: settings.preservePitch,
  });

  const bridge = new PageBridge({ document: doc, getUrl: (path) => api.runtime.getURL(path) });

  const enforcer = new Enforcer({
    registry,
    getTarget: target,
    onTierChange: (tier) => handleTierChange(tier),
    onDivergence: () => reconciler.wake(),
  });

  const reconciler = new Reconciler({ source: enforcer });

  function handleTierChange(tier: Tier): void {
    reconciler.setTier(tier);
    void tierStore.set(host(), tier);
    syncPageWorld(tier);
  }

  function syncPageWorld(tier: Tier): void {
    if (needsPageWorld(tier) && settings.enforcement.allowPageWorld) bridge.activate(target());
    else bridge.deactivate();
  }

  function refresh(): void {
    enforcer.applyAll();
    if (needsPageWorld(enforcer.tier)) bridge.activate(target());
    report();
  }

  function report(): void {
    const speed = targetSpeed();
    if (lastReported !== null && speedsEqual(lastReported, speed)) return;
    lastReported = speed;
    void api.runtime.sendMessage({ type: "speed-changed", speed }).catch(ignore);
  }

  function runCommand(command: CommandName): void {
    if (command === "reset-default") override = null;
    else if (command === "toggle-normal") override = speedsEqual(targetSpeed(), NORMAL_SPEED) ? null : NORMAL_SPEED;
    else override = stepSpeed(targetSpeed(), settings.step, command === "speed-up" ? 1 : -1);
    refresh();
  }

  const handleMessage = (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: unknown) => void,
  ): void => {
    const request = parseContentRequest(message);
    if (!request) return;
    if (request.type === "command") runCommand(request.command);
    else if (request.type === "set-speed") {
      override = conformSpeed(request.speed);
      refresh();
    }
    sendResponse(snapshot());
  };

  function snapshot(): ContentState {
    return {
      url: pageUrl(),
      speed: targetSpeed(),
      ruleSpeed: ruleSpeed(),
      override,
      tier: enforcer.tier,
      mediaCount: registry.mediaCount,
    };
  }

  const handleVisibility = (): void => {
    reconciler.setVisible(doc.visibilityState !== "hidden");
  };

  const stopDiscovery = startDiscovery({
    document: doc,
    registry,
    onMedia: (media) => enforcer.apply(media),
    onEvent: (media, type) => enforcer.handleEvent(media, type),
  });

  const unsubscribe = settingsStore.subscribe((next) => {
    settings = next;
    syncPageWorld(enforcer.tier);
    refresh();
  });

  api.runtime.onMessage.addListener(handleMessage);
  doc.addEventListener("visibilitychange", handleVisibility);

  const ready = initialise();

  async function initialise(): Promise<void> {
    settings = await settingsStore.load();
    refresh();
    const learned = await tierStore.get(host());
    if (learned !== null && learned > enforcer.tier) enforcer.setTier(learned);
  }

  return {
    ready,
    get state() {
      return snapshot();
    },
    stop() {
      stopDiscovery();
      unsubscribe();
      reconciler.stop();
      bridge.dispose();
      api.runtime.onMessage.removeListener(handleMessage);
      doc.removeEventListener("visibilitychange", handleVisibility);
    },
  };
}

/**
 * An `about:blank` or `srcdoc` frame has no URL of its own to match rules
 * against, so it inherits the page that created it.
 */
export function effectiveUrl(href: string, referrer: string): string {
  try {
    if (new URL(href).hostname !== "") return href;
  } catch {
    return href;
  }
  return referrer || href;
}

function ignore(): void {}
