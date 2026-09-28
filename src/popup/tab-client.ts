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

const TOP_FRAME = { frameId: 0 };

export function createTabClient(api: WebExtensionApi = getBrowser()): TabClient {
  const ask = async (request: ContentRequest): Promise<ContentState | null> => {
    try {
      const [tab] = (await api.tabs?.query({ active: true, currentWindow: true })) ?? [];
      if (tab?.id === undefined) return null;
      // A change goes to every frame, as a hotkey does, so embedded players
      // follow it. The state always comes from the top frame: left to the
      // first reply, a page with iframes could report an ad frame's URL, and
      // the pin buttons would pin that host instead.
      if (request.type !== "get-state") await api.tabs?.sendMessage(tab.id, request);
      const reply = await api.tabs?.sendMessage(tab.id, { type: "get-state" }, TOP_FRAME);
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
