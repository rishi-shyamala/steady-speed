/** Boots the popup against the real browser APIs. */
import { createSettingsStore } from "../platform/storage";
import { getBrowser } from "../platform/webext";
import { createTabClient } from "./tab-client";
import { renderPopup } from "./view";

const root = document.getElementById("root");
const api = getBrowser();

if (root) {
  renderPopup(root, {
    client: createTabClient(api),
    settings: createSettingsStore(api),
    openOptions: () => api.runtime.openOptionsPage?.(),
  });
}
