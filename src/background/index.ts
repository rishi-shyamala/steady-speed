/**
 * The background page does two things, and deliberately nothing else.
 *
 * Hotkeys arrive here because `commands.onCommand` only fires in the background,
 * and the toolbar badge lives here because only the background can address a
 * tab. Both are done without the `tabs` permission: the command listener is
 * handed the active tab, and badge updates use the tab the message came from.
 */

import { formatBadge, formatSpeed } from "../core/speed";
import { isCommandName, parseBackgroundRequest } from "../platform/messages";
import { getBrowser, type MessageSender, type WebExtensionApi } from "../platform/webext";

const BADGE_COLOR = "#0B6E62";

export interface BackgroundHandle {
  stop(): void;
}

export function startBackground(api: WebExtensionApi = getBrowser()): BackgroundHandle {
  void api.action?.setBadgeBackgroundColor({ color: BADGE_COLOR });

  const handleCommand = (command: string, tab?: { id?: number }): void => {
    if (!isCommandName(command) || tab?.id === undefined) return;
    void Promise.resolve(api.tabs?.sendMessage(tab.id, { type: "command", command })).catch(ignore);
  };

  const handleMessage = (message: unknown, sender: MessageSender): void => {
    const request = parseBackgroundRequest(message);
    const tabId = sender.tab?.id;
    if (!request || tabId === undefined) return;
    // Only the top frame speaks for the tab; a frame's own speed is its own.
    if (sender.frameId !== undefined && sender.frameId !== 0) return;

    void api.action?.setBadgeText({ text: formatBadge(request.speed), tabId });
    void api.action?.setTitle({ title: `Steady — ${formatSpeed(request.speed)}`, tabId });
  };

  api.commands?.onCommand.addListener(handleCommand);
  api.runtime.onMessage.addListener(handleMessage);

  return {
    stop() {
      api.runtime.onMessage.removeListener(handleMessage);
    },
  };
}

function ignore(): void {}
