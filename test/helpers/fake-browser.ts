/**
 * A hand-rolled fake of the WebExtension slice declared in src/platform/webext.ts.
 *
 * Written by hand rather than pulled from a package: this file is test-only, but
 * a mocking library would still be a build-time dependency, and the fake is
 * small enough that its fidelity can be reviewed directly.
 */
import type {
  ActionApi,
  MessageListener,
  MessageSender,
  StorageArea,
  StorageChanges,
  WebExtensionApi,
} from "../../src/platform/webext";

type ChangeListener = (changes: StorageChanges, areaName: string) => void;

export interface FakeBrowser extends WebExtensionApi {
  /** Everything currently in storage.local, for assertions. */
  readonly store: Map<string, unknown>;
  /** Badge state keyed by tab id, or "global" when no tabId was given. */
  readonly badges: Map<string, string>;
  /** Messages passed to runtime.sendMessage, in order. */
  readonly sent: unknown[];
  /** Deliver a message to registered runtime.onMessage listeners. */
  deliverMessage(message: unknown, sender?: MessageSender): unknown[];
  /** Fire a registered command, as the browser would on a hotkey. */
  fireCommand(command: string): void;
  /** Replace storage contents without firing change events. */
  seed(items: Record<string, unknown>): void;
}

export function createFakeBrowser(): FakeBrowser {
  const store = new Map<string, unknown>();
  const badges = new Map<string, string>();
  const sent: unknown[] = [];
  const changeListeners = new Set<ChangeListener>();
  const messageListeners = new Set<MessageListener>();
  const commandListeners = new Set<(command: string) => void>();

  const emit = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>): void => {
    if (Object.keys(changes).length === 0) return;
    for (const listener of [...changeListeners]) listener(changes, "local");
  };

  const local: StorageArea = {
    async get(keys) {
      const wanted =
        keys === undefined || keys === null
          ? [...store.keys()]
          : typeof keys === "string"
            ? [keys]
            : [...keys];
      const result: Record<string, unknown> = {};
      for (const key of wanted) {
        if (store.has(key)) result[key] = structuredClone(store.get(key));
      }
      return result;
    },
    async set(items) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [key, value] of Object.entries(items)) {
        const oldValue = store.get(key);
        const newValue = structuredClone(value);
        store.set(key, newValue);
        changes[key] = { oldValue, newValue };
      }
      emit(changes);
    },
    async remove(keys) {
      const list = typeof keys === "string" ? [keys] : [...keys];
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const key of list) {
        if (!store.has(key)) continue;
        changes[key] = { oldValue: store.get(key) };
        store.delete(key);
      }
      emit(changes);
    },
  };

  const action: ActionApi = {
    setBadgeText({ text, tabId }) {
      badges.set(tabId === undefined ? "global" : String(tabId), text);
    },
    setBadgeBackgroundColor() {},
    setTitle() {},
  };

  return {
    store,
    badges,
    sent,
    storage: {
      local,
      onChanged: {
        addListener: (cb) => void changeListeners.add(cb),
        removeListener: (cb) => void changeListeners.delete(cb),
      },
    },
    runtime: {
      getURL: (path) => `moz-extension://fake/${path.replace(/^\//, "")}`,
      async sendMessage(message) {
        sent.push(message);
        return undefined;
      },
      onMessage: {
        addListener: (cb) => void messageListeners.add(cb),
        removeListener: (cb) => void messageListeners.delete(cb),
      },
    },
    commands: {
      onCommand: { addListener: (cb) => void commandListeners.add(cb) },
    },
    action,
    deliverMessage(message, sender = {}) {
      return [...messageListeners].map((listener) => listener(message, sender));
    },
    fireCommand(command) {
      for (const listener of [...commandListeners]) listener(command);
    },
    seed(items) {
      for (const [key, value] of Object.entries(items)) store.set(key, structuredClone(value));
    },
  };
}
