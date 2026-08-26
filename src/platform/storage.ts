/**
 * The only place settings meet browser storage.
 *
 * Content scripts read this directly rather than asking the background page, so
 * the path from document_start to a speed being applied is one storage read with
 * no messaging round-trip.
 */

import type { Tier } from "../core/escalation";
import { normalizeSettings, type Settings } from "../core/settings";
import { getBrowser, type StorageChanges, type WebExtensionApi } from "./webext";

/** Everything lives under one key, so one change event covers every update. */
export const SETTINGS_KEY = "settings";
/** Learned enforcement tiers, keyed by host. Derived state, not user settings. */
export const TIERS_KEY = "learnedTiers";
/** Bounded so a lot of browsing cannot grow storage without limit. */
export const MAX_LEARNED_TIERS = 200;

export type SettingsListener = (settings: Settings) => void;

export interface SettingsStore {
  /** Current settings, always usable, even if storage is empty or corrupt. */
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
  /** Read, apply, write. Returns what was written. */
  update(apply: (current: Settings) => Settings): Promise<Settings>;
  /** Called whenever settings change, from any tab or from the options page. */
  subscribe(listener: SettingsListener): () => void;
}

export function createSettingsStore(
  api: WebExtensionApi = getBrowser(),
  onListenerError: (error: unknown) => void = () => {},
): SettingsStore {
  const listeners = new Set<SettingsListener>();
  let attached = false;

  const handleChange = (changes: StorageChanges, areaName: string): void => {
    if (areaName !== "local") return;
    const change = changes[SETTINGS_KEY];
    if (change === undefined) return;
    const settings = normalizeSettings(change.newValue);
    for (const listener of [...listeners]) {
      try {
        listener(settings);
      } catch (error) {
        onListenerError(error);
      }
    }
  };

  const load = async (): Promise<Settings> => {
    try {
      const stored = await api.storage.local.get(SETTINGS_KEY);
      return normalizeSettings(stored[SETTINGS_KEY]);
    } catch {
      return normalizeSettings(undefined);
    }
  };

  return {
    load,

    async save(settings) {
      await api.storage.local.set({ [SETTINGS_KEY]: settings });
    },

    async update(apply) {
      const next = apply(await load());
      await api.storage.local.set({ [SETTINGS_KEY]: next });
      return next;
    },

    subscribe(listener) {
      if (!attached) {
        api.storage.onChanged.addListener(handleChange);
        attached = true;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface TierStore {
  /** The tier this host needed last time, or null if it has never misbehaved. */
  get(host: string): Promise<Tier | null>;
  /** Every host that has needed more than tier 0, for the options page. */
  list(): Promise<Record<string, Tier>>;
  /** Remembers a tier. Tier 0 forgets the host instead of storing a zero. */
  set(host: string, tier: Tier): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Remembering which sites fight lets the second page load start at the rung it
 * needs, instead of re-earning it. It is a cache, so every failure path here
 * degrades to "start from scratch" rather than breaking playback.
 */
export function createTierStore(api: WebExtensionApi = getBrowser()): TierStore {
  const read = async (): Promise<Record<string, number>> => {
    try {
      const stored = await api.storage.local.get(TIERS_KEY);
      const value = stored[TIERS_KEY];
      return isTierMap(value) ? value : {};
    } catch {
      return {};
    }
  };

  return {
    async get(host) {
      const tiers = await read();
      const tier = tiers[host];
      return tier === undefined ? null : clampTier(tier);
    },

    async list() {
      const tiers = await read();
      return Object.fromEntries(
        Object.entries(tiers).map(([host, tier]) => [host, clampTier(tier)]),
      );
    },

    async set(host, tier) {
      if (host === "") return;
      const tiers = await read();
      if (tier <= 0) {
        if (!(host in tiers)) return;
        delete tiers[host];
      } else {
        if (tiers[host] === tier) return;
        delete tiers[host];
        tiers[host] = tier;
      }
      await api.storage.local.set({ [TIERS_KEY]: trim(tiers) });
    },

    async clear() {
      await api.storage.local.remove(TIERS_KEY);
    },
  };
}

/** Drops the least recently written hosts once the cache is full. */
function trim(tiers: Record<string, number>): Record<string, number> {
  const entries = Object.entries(tiers);
  if (entries.length <= MAX_LEARNED_TIERS) return tiers;
  return Object.fromEntries(entries.slice(entries.length - MAX_LEARNED_TIERS));
}

function isTierMap(value: unknown): value is Record<string, number> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampTier(value: number): Tier {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 3) return 3;
  return Math.round(value) as Tier;
}
