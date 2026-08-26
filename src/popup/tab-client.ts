/**
 * Talking to the frame the popup was opened over.
 *
 * `tabs.query` is used only for the active tab's id: without the `tabs`
 * permission the browser gives no url or title, which is deliberate — the page
 * reports its own URL in its state instead.
 */

import { parseContentRequest, type ContentRequest, type ContentState } from "../platform/messages";
import { getBrowser, type WebExtensionApi } from "../platform/webext";

export interface TabClient {
  /** Null when nothing answered: an internal page, or a frame with no script. */
  getState(): Promise<ContentState | null>;
  send(request: ContentRequest): Promise<ContentState | null>;
}

export function createTabClient(api: WebExtensionApi = getBrowser()): TabClient {
  const ask = async (request: ContentRequest): Promise<ContentState | null> => {
    try {
      const [tab] = (await api.tabs?.query({ active: true, currentWindow: true })) ?? [];
      if (tab?.id === undefined) return null;
      const reply = await api.tabs?.sendMessage(tab.id, request);
      return isContentState(reply) ? reply : null;
    } catch {
      return null;
    }
  };

  return {
    getState: () => ask({ type: "get-state" }),
    send: (request) => {
      // Guards against a caller inventing a request the content script ignores.
      const parsed = parseContentRequest(request);
      return parsed ? ask(parsed) : Promise.resolve(null);
    },
  };
}

function isContentState(value: unknown): value is ContentState {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.url === "string" && typeof record.speed === "number";
}
