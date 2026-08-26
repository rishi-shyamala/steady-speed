/**
 * Static guards that make the extension's promises falsifiable.
 *
 * These are pure functions so they can be unit tested; scripts/guard.mjs is the
 * thin wrapper that feeds them the built artifact.
 */

/** Identifiers that must never appear in shipped code. */
export const FORBIDDEN_IDENTIFIERS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "importScripts",
  "RTCPeerConnection",
  "eval",
];

/** Source-level patterns that must never appear in shipped code. */
export const FORBIDDEN_PATTERNS = [
  { name: "new Function", regex: /\bnew\s+Function\s*\(/ },
  { name: "remote import()", regex: /\bimport\s*\(\s*["'`]https?:/ },
  { name: "remote script src", regex: /\.src\s*=\s*["'`]https?:/ },
];

/**
 * @param {string} source
 * @param {string[]} [identifiers]
 * @returns {string[]} the forbidden identifiers present in `source`
 */
export function findForbiddenIdentifiers(source, identifiers = FORBIDDEN_IDENTIFIERS) {
  const stripped = stripCommentsAndStrings(source);
  return identifiers.filter((id) => new RegExp(`\\b${escapeRegExp(id)}\\b`).test(stripped));
}

/**
 * @param {string} source
 * @param {{ name: string, regex: RegExp }[]} [patterns]
 * @returns {string[]} the names of the forbidden patterns present in `source`
 */
export function findForbiddenPatterns(source, patterns = FORBIDDEN_PATTERNS) {
  const stripped = stripComments(source);
  return patterns.filter((p) => p.regex.test(stripped)).map((p) => p.name);
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string[]} forbiddenPermissions
 * @returns {string[]} permissions requested that are on the forbidden list
 */
export function findForbiddenPermissions(manifest, forbiddenPermissions) {
  const requested = [
    ...toArray(manifest.permissions),
    ...toArray(manifest.optional_permissions),
    ...toArray(manifest.host_permissions),
  ];
  return forbiddenPermissions.filter((p) => requested.includes(p));
}

/** @param {unknown} value @returns {string[]} */
function toArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

/** @param {string} source @returns {string} */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
}

/**
 * Comments and string literals are removed before identifier scanning so that a
 * doc comment naming `fetch` does not trip the guard, while real calls do.
 * @param {string} source
 * @returns {string}
 */
function stripCommentsAndStrings(source) {
  return stripComments(source)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** @param {string} value @returns {string} */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validates a `commands` suggested shortcut against the grammar both browsers
 * accept: a required Ctrl/Alt/Command/MacCtrl modifier, an optional Shift, and
 * one key from the supported list.
 *
 * @param {string} shortcut
 * @param {Set<string>} keys
 * @returns {string | null} the problem, or null when the shortcut is fine
 */
export function checkShortcut(shortcut, keys) {
  const parts = shortcut.split("+");
  if (parts.length < 2 || parts.length > 3) return "must be a modifier plus a key";

  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  const primary = modifiers[0];

  if (!["Ctrl", "Alt", "Command", "MacCtrl"].includes(primary)) {
    return "must start with Ctrl, Alt, Command or MacCtrl";
  }
  if (modifiers.length === 2 && modifiers[1] !== "Shift") return "the only second modifier is Shift";
  if (!keys.has(key)) return `\`${key}\` is not a key browsers accept in a shortcut`;
  return null;
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {Set<string>} keys
 * @returns {string[]}
 */
export function findBadShortcuts(manifest, keys) {
  const commands = manifest.commands;
  if (typeof commands !== "object" || commands === null) return [];

  const problems = [];
  for (const [name, command] of Object.entries(commands)) {
    const suggested = command?.suggested_key;
    if (typeof suggested !== "object" || suggested === null) continue;
    for (const [platform, shortcut] of Object.entries(suggested)) {
      if (typeof shortcut !== "string") continue;
      const problem = checkShortcut(shortcut, keys);
      if (problem) problems.push(`${name} (${platform}) "${shortcut}": ${problem}`);
    }
  }
  return problems;
}
