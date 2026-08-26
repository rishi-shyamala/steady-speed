/**
 * Single source of truth for the extension manifest.
 *
 * Firefox/Zen is the shipped target. The chromium variant exists only so the
 * end-to-end suite can drive a real browser inside CI, and is not supported.
 */

export const EXTENSION_ID = "{6a2f0d3c-8f5a-4b7e-9c21-0f4a1d6e83b7}";

/** Permissions we deliberately never request, asserted by scripts/guard.mjs. */
export const FORBIDDEN_PERMISSIONS = [
  "tabs",
  "webRequest",
  "webRequestBlocking",
  "cookies",
  "history",
  "bookmarks",
  "downloads",
  "nativeMessaging",
  "clipboardRead",
  "clipboardWrite",
  "webNavigation",
  "contextMenus",
  "management",
  "privacy",
  "proxy",
  "scripting",
  "<all_urls>",
];

const MATCHES = ["http://*/*", "https://*/*", "file:///*"];

/**
 * The keys both Firefox and Chromium accept in a `suggested_key`. Anything else
 * makes the browser reject the whole manifest, silently, at install time - which
 * is exactly the kind of failure a build should catch rather than a user.
 */
export const SHORTCUT_KEYS = new Set([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
  "Comma",
  "Period",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Space",
  "Insert",
  "Delete",
  "Up",
  "Down",
  "Left",
  "Right",
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  "MediaNextTrack",
  "MediaPlayPause",
  "MediaPrevTrack",
  "MediaStop",
]);

const COMMANDS = {
  "speed-up": {
    suggested_key: { default: "Alt+Period" },
    description: "Increase playback speed by one step",
  },
  "speed-down": {
    suggested_key: { default: "Alt+Comma" },
    description: "Decrease playback speed by one step",
  },
  "toggle-normal": {
    suggested_key: { default: "Alt+0" },
    description: "Toggle between 1x and your default speed",
  },
  "reset-default": {
    suggested_key: { default: "Alt+Shift+0" },
    description: "Reset this site to your default speed",
  },
};

/**
 * @param {{ target: "firefox" | "chromium", version: string }} options
 */
export function buildManifest({ target, version }) {
  /** @type {Record<string, unknown>} */
  const manifest = {
    manifest_version: 3,
    name: "Steady",
    version,
    description:
      "Sets your chosen playback speed on every video and audio element, on every site, on every reload.",
    permissions: ["storage"],
    host_permissions: MATCHES,
    content_scripts: [
      {
        matches: MATCHES,
        js: ["content.js"],
        all_frames: true,
        match_about_blank: true,
        run_at: "document_start",
      },
    ],
    web_accessible_resources: [{ resources: ["page-agent.js"], matches: MATCHES }],
    action: { default_popup: "popup.html" },
    options_ui: { page: "options.html", open_in_tab: true },
    commands: COMMANDS,
  };

  if (target === "firefox") {
    manifest.browser_specific_settings = {
      gecko: {
        id: EXTENSION_ID,
        strict_min_version: "128.0",
        data_collection_permissions: { required: ["none"] },
      },
    };
    manifest.icons = { 48: "icons/icon.svg", 96: "icons/icon.svg" };
    manifest.action = { default_popup: "popup.html", default_icon: "icons/icon.svg" };
    manifest.background = { scripts: ["background.js"] };
  } else {
    manifest.background = { service_worker: "background.js" };
  }

  return manifest;
}
