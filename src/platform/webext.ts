/**
 * Hand-written declarations for the exact slice of the WebExtension API this
 * extension touches. Nothing else is reachable from the typed surface, which
 * makes the API footprint auditable by reading one file.
 */

export interface StorageChange {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

export type StorageChanges = Readonly<Record<string, StorageChange>>;

export interface StorageArea {
  get(keys?: string | readonly string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | readonly string[]): Promise<void>;
}

export interface StorageOnChanged {
  addListener(callback: (changes: StorageChanges, areaName: string) => void): void;
  removeListener(callback: (changes: StorageChanges, areaName: string) => void): void;
}

export interface MessageSender {
  readonly tab?: { readonly id?: number };
  readonly frameId?: number;
}

export type MessageListener = (message: unknown, sender: MessageSender) => unknown;

export interface RuntimeApi {
  getURL(path: string): string;
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: {
    addListener(callback: MessageListener): void;
    removeListener(callback: MessageListener): void;
  };
}

export interface TabRef {
  readonly id?: number;
}

export interface CommandsApi {
  onCommand: {
    /**
     * Firefox and Chromium both hand the active tab to the listener, which is
     * why this extension never needs the `tabs` permission to find it.
     */
    addListener(callback: (command: string, tab?: TabRef) => void): void;
  };
}

export interface TabsApi {
  /** Works without the `tabs` permission; host permission covers the target. */
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
  /**
   * Available without the `tabs` permission, but the returned tabs then carry
   * no url or title - only the id, which is all the popup needs.
   */
  query(query: { active: boolean; currentWindow: boolean }): Promise<TabRef[]>;
}

export interface ActionApi {
  setBadgeText(details: { text: string; tabId?: number }): void | Promise<void>;
  setBadgeBackgroundColor(details: { color: string; tabId?: number }): void | Promise<void>;
  setTitle(details: { title: string; tabId?: number }): void | Promise<void>;
}

export interface PermissionsApi {
  contains(permissions: { origins?: readonly string[] }): Promise<boolean>;
  request(permissions: { origins?: readonly string[] }): Promise<boolean>;
}

export interface WebExtensionApi {
  storage: { local: StorageArea; onChanged: StorageOnChanged };
  runtime: RuntimeApi;
  commands?: CommandsApi;
  tabs?: TabsApi;
  action?: ActionApi;
  permissions?: PermissionsApi;
}

interface MaybeGlobal {
  browser?: WebExtensionApi;
  chrome?: WebExtensionApi;
}

/**
 * Firefox exposes a promise-based `browser`; Chromium exposes `chrome`, which is
 * promise-based under MV3. Everything downstream depends on this one lookup.
 */
export function getBrowser(scope: MaybeGlobal = globalThis as MaybeGlobal): WebExtensionApi {
  const api = scope.browser ?? scope.chrome;
  if (!api) throw new Error("WebExtension API unavailable");
  return api;
}
