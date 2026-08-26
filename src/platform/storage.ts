/**
 * The only place settings meet browser storage.
 *
 * Content scripts read this directly rather than asking the background page, so
 * the path from document_start to a speed being applied is one storage read with
 * no messaging round-trip.
 */

import { normalizeSettings, type Settings } from "../core/settings";
import { getBrowser, type StorageChanges, type WebExtensionApi } from "./webext";

/** Everything lives under one key, so one change event covers every update. */
export const SETTINGS_KEY = "settings";

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
