/** Boots the settings page against the real browser APIs. */
import { createSettingsStore, createTierStore } from "../platform/storage";
import { getBrowser } from "../platform/webext";
import { renderOptions } from "./view";

const root = document.getElementById("root");
const api = getBrowser();

if (root) {
  renderOptions(root, { settings: createSettingsStore(api), tiers: createTierStore(api) });
}
