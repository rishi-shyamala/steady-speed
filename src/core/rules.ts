/**
 * Site rules: which speed applies where.
 *
 * The "always 1x" list is not a separate concept — it is rules whose speed is 1.
 * One data structure, one matcher, one ordering.
 *
 * Pattern syntax, in the order a user is likely to reach for it:
 *
 *   example.com          the domain and every subdomain of it
 *   *.example.com        subdomains only, not the apex
 *   =example.com         that host exactly, no subdomains
 *   example.com/shorts   as above, but only under that path
 *   localhost:8096       a specific port
 *   https://example.com  a specific scheme
 *   file://              every local file
 *
 * When several rules match, the most specific wins: more host labels first,
 * then an exact host over a subdomain match, then a deeper path, then a named
 * scheme, then a named port. Ties are broken by position in the list, so the
 * rule editor stays predictable.
 */

import { conformSpeed } from "./speed";

export interface SiteRule {
  id: string;
  pattern: string;
  speed: number;
  enabled: boolean;
}

export interface ParsedTarget {
  scheme: string;
  host: string;
  port: string;
  path: string;
}

export interface ParsedPattern {
  scheme: string | null;
  /** null means the pattern constrains only the scheme, as with `file://`. */
  host: string | null;
  port: string;
  exact: boolean;
  matchSubdomains: boolean;
  apex: boolean;
  path: string | null;
  labels: number;
  pathSegments: number;
}

/** Schemes for which a host-less pattern is meaningful rather than a footgun. */
const HOSTLESS_SCHEMES = new Set(["file", "about"]);

const SCHEME_PREFIX = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Splits a page URL into the pieces rules are matched against. */
export function parseTarget(url: string): ParsedTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return {
    scheme: parsed.protocol.slice(0, -1).toLowerCase(),
    host: stripRootDot(parsed.hostname.toLowerCase()),
    port: parsed.port,
    path: parsed.pathname,
  };
}

/** Turns what the user typed into something matchable, or null if it cannot be. */
export function parsePattern(raw: string): ParsedPattern | null {
  let rest = raw.trim();
  if (rest === "") return null;

  let scheme: string | null = null;
  const schemeMatch = SCHEME_PREFIX.exec(rest);
  if (schemeMatch?.[1] !== undefined) {
    scheme = schemeMatch[1].toLowerCase();
    rest = rest.slice(schemeMatch[0].length);
  }

  const exact = rest.startsWith("=");
  if (exact) rest = rest.slice(1);

  const wildcard = rest.startsWith("*.");
  if (wildcard) {
    if (exact) return null;
    rest = rest.slice(2);
  }

  const slash = rest.indexOf("/");
  const hostPart = slash === -1 ? rest : rest.slice(0, slash);
  const pathPart = slash === -1 ? "" : rest.slice(slash);

  if (hostPart === "") {
    const hostless = scheme !== null && HOSTLESS_SCHEMES.has(scheme) && pathPart === "";
    if (!hostless || exact || wildcard) return null;
    return {
      scheme,
      host: null,
      port: "",
      exact: false,
      matchSubdomains: false,
      apex: true,
      path: null,
      labels: 0,
      pathSegments: 0,
    };
  }

  const host = parseHostPart(hostPart);
  if (!host) return null;

  const path = normalizePath(pathPart);
  const isIp = IPV4.test(host.hostname) || host.hostname.startsWith("[");

  return {
    scheme,
    host: host.hostname,
    port: host.port,
    exact,
    matchSubdomains: !exact && !isIp,
    apex: !wildcard,
    path,
    labels: isIp ? 1 : host.hostname.split(".").length,
    pathSegments: path === null ? 0 : path.split("/").filter(Boolean).length,
  };
}

/** Does this pattern apply to this page? */
export function patternMatches(pattern: ParsedPattern, target: ParsedTarget): boolean {
  if (pattern.scheme !== null && pattern.scheme !== target.scheme) return false;

  if (pattern.host !== null) {
    if (target.host === "") return false;
    if (target.host === pattern.host) {
      if (!pattern.apex) return false;
    } else if (!(pattern.matchSubdomains && target.host.endsWith(`.${pattern.host}`))) {
      return false;
    }
    if (pattern.port !== "" && pattern.port !== target.port) return false;
  }

  if (pattern.path !== null) {
    if (target.path !== pattern.path && !target.path.startsWith(`${pattern.path}/`)) return false;
  }

  return true;
}

/** The rule that governs this page, or null if none does. */
export function findMatchingRule(url: string, rules: readonly SiteRule[]): SiteRule | null {
  const target = parseTarget(url);
  if (!target) return null;

  let best: SiteRule | null = null;
  let bestScore: Score | null = null;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const pattern = parsePattern(rule.pattern);
    if (!pattern || !patternMatches(pattern, target)) continue;
    const score = specificity(pattern);
    if (bestScore === null || compareScores(score, bestScore) > 0) {
      best = rule;
      bestScore = score;
    }
  }

  return best;
}

/** The speed this page should play at. Always returns something usable. */
export function resolveSpeed(
  url: string,
  rules: readonly SiteRule[],
  defaultSpeed: number,
): number {
  const fallback = conformSpeed(defaultSpeed);
  const rule = findMatchingRule(url, rules);
  return rule === null ? fallback : conformSpeed(rule.speed, fallback);
}

/** Canonical form of a pattern, for storing and displaying what the user typed. */
export function normalizePattern(raw: string): string | null {
  const pattern = parsePattern(raw);
  if (!pattern) return null;

  const scheme = pattern.scheme === null ? "" : `${pattern.scheme}://`;
  if (pattern.host === null) return `${scheme}`;

  const prefix = pattern.exact ? "=" : pattern.apex ? "" : "*.";
  const port = pattern.port === "" ? "" : `:${pattern.port}`;
  return `${scheme}${prefix}${pattern.host}${port}${pattern.path ?? ""}`;
}

function parseHostPart(hostPart: string): { hostname: string; port: string } | null {
  if (/[*\s?#/@]/.test(hostPart)) return null;
  let parsed: URL;
  try {
    parsed = new URL(`http://${hostPart}`);
  } catch {
    return null;
  }
  const hostname = stripRootDot(parsed.hostname.toLowerCase());
  if (hostname === "") return null;
  return { hostname, port: parsed.port };
}

function normalizePath(pathPart: string): string | null {
  const trimmed = pathPart.replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

function stripRootDot(host: string): string {
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

/** Ordered most-significant first; compared lexicographically. */
type Score = readonly [
  labels: number,
  exact: number,
  pathSegments: number,
  scheme: number,
  port: number,
];

function specificity(pattern: ParsedPattern): Score {
  return [
    pattern.labels,
    pattern.exact ? 1 : 0,
    pattern.pathSegments,
    pattern.scheme === null ? 0 : 1,
    pattern.port === "" ? 0 : 1,
  ];
}

function compareScores(a: Score, b: Score): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4];
}
