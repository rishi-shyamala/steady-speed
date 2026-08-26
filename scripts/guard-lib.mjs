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
