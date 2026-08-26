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
  TabRef,
  TabsApi,
  WebExtensionApi,
} from "../../src/platform/webext";

type ChangeListener = (changes: StorageChanges, areaName: string) => void;

export interface FakeBrowser extends WebExtensionApi {
  /** Always present on the fake, unlike the optional real API. */
  tabs: TabsApi;
  action: ActionApi;
  /** Everything currently in storage.local, for assertions. */
  readonly store: Map<string, unknown>;
  /** Badge state keyed by tab id, or "global" when no tabId was given. */
  readonly badges: Map<string, string>;
  /** Messages passed to runtime.sendMessage, in order. */
  readonly sent: unknown[];
  /** Messages passed to tabs.sendMessage, in order. */
  readonly tabMessages: { tabId: number; message: unknown }[];
  /** Titles set on the toolbar button, keyed the same way as badges. */
  readonly titles: Map<string, string>;
  /** The colour the badge was last given. */
  badgeColor: string | null;
  /** Tabs that tabs.query will report. */
  activeTabs: TabRef[];
  /**
   * Deliver a message to registered runtime.onMessage listeners, returning
   * whatever each of them passed to sendResponse.
   */
  deliverMessage(message: unknown, sender?: MessageSender): unknown[];
  /** Fire a registered command, as the browser would on a hotkey. */
  fireCommand(command: string, tab?: TabRef): void;
  /** Replace storage contents without firing change events. */
  seed(items: Record<string, unknown>): void;
}

export function createFakeBrowser(): FakeBrowser {
  const store = new Map<string, unknown>();
  const badges = new Map<string, string>();
  const sent: unknown[] = [];
  const tabMessages: { tabId: number; message: unknown }[] = [];
  const titles = new Map<string, string>();
  const changeListeners = new Set<ChangeListener>();
  const messageListeners = new Set<MessageListener>();
  const commandListeners = new Set<(command: string, tab?: TabRef) => void>();

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

  const fake = {
    badgeColor: null as string | null,
    activeTabs: [] as TabRef[],
  };

  const action: ActionApi = {
    setBadgeText({ text, tabId }) {
      badges.set(tabId === undefined ? "global" : String(tabId), text);
    },
    setBadgeBackgroundColor({ color }) {
      fake.badgeColor = color;
    },
    setTitle({ title, tabId }) {
      titles.set(tabId === undefined ? "global" : String(tabId), title);
    },
  };

  const tabs: TabsApi = {
    async sendMessage(tabId, message) {
      tabMessages.push({ tabId, message });
      return undefined;
    },
    async query() {
      return fake.activeTabs;
    },
  };

  return {
    store,
    badges,
    sent,
    tabMessages,
    titles,
    get badgeColor() {
      return fake.badgeColor;
    },
    get activeTabs() {
      return fake.activeTabs;
    },
    set activeTabs(value: TabRef[]) {
      fake.activeTabs = value;
    },
    tabs,
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
      const replies: unknown[] = [];
      for (const listener of [...messageListeners]) {
        listener(message, sender, (response) => replies.push(response));
      }
      return replies;
    },
    fireCommand(command, tab) {
      for (const listener of [...commandListeners]) listener(command, tab);
    },
    seed(items) {
      for (const [key, value] of Object.entries(items)) store.set(key, structuredClone(value));
    },
  };
}
