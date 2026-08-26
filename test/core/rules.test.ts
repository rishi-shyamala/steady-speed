import { describe, expect, it } from "vitest";
import {
  findMatchingRule,
  normalizePattern,
  parsePattern,
  parseTarget,
  patternMatches,
  resolveSpeed,
} from "../../src/core/rules";
import type { SiteRule } from "../../src/core/rules";

let nextId = 0;
function rule(pattern: string, speed: number, enabled = true): SiteRule {
  nextId += 1;
  return { id: `r${nextId}`, pattern, speed, enabled };
}

/** Convenience: does this pattern match this URL? */
function hits(pattern: string, url: string): boolean {
  const parsedPattern = parsePattern(pattern);
  const target = parseTarget(url);
  if (!parsedPattern || !target) return false;
  return patternMatches(parsedPattern, target);
}

describe("parseTarget", () => {
  it("pulls apart an ordinary page URL", () => {
    expect(parseTarget("https://www.example.com/watch?v=1#t")).toEqual({
      scheme: "https",
      host: "www.example.com",
      port: "",
      path: "/watch",
    });
  });

  it("lowercases the host and drops the root dot", () => {
    expect(parseTarget("https://WWW.Example.COM./x")?.host).toBe("www.example.com");
  });

  it("keeps an explicit port", () => {
    expect(parseTarget("http://localhost:8080/")?.port).toBe("8080");
  });

  it("keeps path case, because paths are case sensitive", () => {
    expect(parseTarget("https://example.com/Watch")?.path).toBe("/Watch");
  });

  it("handles a local file", () => {
    expect(parseTarget("file:///home/rishi/clip.mp4")).toEqual({
      scheme: "file",
      host: "",
      port: "",
      path: "/home/rishi/clip.mp4",
    });
  });

  it("handles about:blank, which has no host", () => {
    expect(parseTarget("about:blank")?.host).toBe("");
  });

  it("normalises an internationalised domain to punycode", () => {
    expect(parseTarget("https://münchen.de/")?.host).toBe("xn--mnchen-3ya.de");
  });

  it("returns null for things that are not URLs", () => {
    expect(parseTarget("")).toBeNull();
    expect(parseTarget("not a url")).toBeNull();
    expect(parseTarget("example.com")).toBeNull();
  });
});

describe("parsePattern", () => {
  it("treats a bare domain as that domain and its subdomains", () => {
    const parsed = parsePattern("example.com");
    expect(parsed).toMatchObject({ host: "example.com", matchSubdomains: true, apex: true });
  });

  it("treats a leading = as an exact host", () => {
    expect(parsePattern("=example.com")).toMatchObject({
      host: "example.com",
      matchSubdomains: false,
      apex: true,
    });
  });

  it("treats *. as subdomains without the apex", () => {
    expect(parsePattern("*.example.com")).toMatchObject({
      host: "example.com",
      matchSubdomains: true,
      apex: false,
    });
  });

  it("keeps a scheme when one is given", () => {
    expect(parsePattern("https://example.com")?.scheme).toBe("https");
    expect(parsePattern("example.com")?.scheme).toBeNull();
  });

  it("accepts a scheme on its own", () => {
    expect(parsePattern("file://")).toMatchObject({ scheme: "file", host: null });
  });

  it("keeps a path prefix and drops its trailing slash", () => {
    expect(parsePattern("example.com/shorts/")?.path).toBe("/shorts");
    expect(parsePattern("example.com")?.path).toBeNull();
    expect(parsePattern("example.com/")?.path).toBeNull();
  });

  it("keeps an explicit port", () => {
    expect(parsePattern("localhost:8080")).toMatchObject({ host: "localhost", port: "8080" });
  });

  it("normalises case, whitespace and the root dot", () => {
    expect(parsePattern("  Example.COM.  ")?.host).toBe("example.com");
  });

  it("normalises an internationalised domain to punycode", () => {
    expect(parsePattern("münchen.de")?.host).toBe("xn--mnchen-3ya.de");
  });

  it("never subdomain-matches an IP address", () => {
    expect(parsePattern("192.168.1.5")).toMatchObject({ matchSubdomains: false });
    expect(parsePattern("[::1]")).toMatchObject({ matchSubdomains: false });
  });

  it("rejects input that cannot be a site", () => {
    expect(parsePattern("")).toBeNull();
    expect(parsePattern("   ")).toBeNull();
    expect(parsePattern("=")).toBeNull();
    expect(parsePattern("*.")).toBeNull();
    expect(parsePattern("ex*ample.com")).toBeNull();
    expect(parsePattern("http://")).toBeNull();
    expect(parsePattern("/just/a/path")).toBeNull();
    expect(parsePattern("=*.example.com")).toBeNull();
    expect(parsePattern("[")).toBeNull();
    expect(parsePattern(".")).toBeNull();
  });
});

describe("patternMatches — hosts", () => {
  it("matches the apex and any subdomain for a bare domain", () => {
    expect(hits("example.com", "https://example.com/")).toBe(true);
    expect(hits("example.com", "https://www.example.com/")).toBe(true);
    expect(hits("example.com", "https://a.b.example.com/")).toBe(true);
  });

  it("does not match a domain that merely ends with the same letters", () => {
    expect(hits("example.com", "https://notexample.com/")).toBe(false);
    expect(hits("example.com", "https://example.com.evil.test/")).toBe(false);
  });

  it("excludes the apex for *.", () => {
    expect(hits("*.example.com", "https://example.com/")).toBe(false);
    expect(hits("*.example.com", "https://www.example.com/")).toBe(true);
  });

  it("excludes subdomains for =", () => {
    expect(hits("=example.com", "https://example.com/")).toBe(true);
    expect(hits("=example.com", "https://www.example.com/")).toBe(false);
  });

  it("matches a subdomain pattern only under that subdomain", () => {
    expect(hits("music.youtube.com", "https://music.youtube.com/x")).toBe(true);
    expect(hits("music.youtube.com", "https://www.youtube.com/x")).toBe(false);
  });

  it("matches an IP address exactly", () => {
    expect(hits("192.168.1.5", "http://192.168.1.5:8096/web/")).toBe(true);
    expect(hits("192.168.1.5", "http://1.192.168.1.5/")).toBe(false);
  });

  it("matches localhost", () => {
    expect(hits("localhost", "http://localhost:8096/web/")).toBe(true);
  });

  it("matches internationalised domains through punycode from either side", () => {
    expect(hits("münchen.de", "https://xn--mnchen-3ya.de/")).toBe(true);
    expect(hits("xn--mnchen-3ya.de", "https://münchen.de/")).toBe(true);
  });
});

describe("patternMatches — schemes, ports and paths", () => {
  it("ignores the scheme when the pattern does not name one", () => {
    expect(hits("example.com", "http://example.com/")).toBe(true);
    expect(hits("example.com", "https://example.com/")).toBe(true);
  });

  it("honours the scheme when the pattern names one", () => {
    expect(hits("https://example.com", "https://example.com/")).toBe(true);
    expect(hits("https://example.com", "http://example.com/")).toBe(false);
  });

  it("matches every local file for a scheme-only pattern", () => {
    expect(hits("file://", "file:///home/rishi/clip.mp4")).toBe(true);
    expect(hits("file://", "https://example.com/")).toBe(false);
  });

  it("ignores the port when the pattern does not name one", () => {
    expect(hits("localhost", "http://localhost:9000/")).toBe(true);
  });

  it("honours the port when the pattern names one", () => {
    expect(hits("localhost:8096", "http://localhost:8096/")).toBe(true);
    expect(hits("localhost:8096", "http://localhost:9000/")).toBe(false);
  });

  it("treats a path as a prefix on segment boundaries", () => {
    expect(hits("youtube.com/shorts", "https://youtube.com/shorts")).toBe(true);
    expect(hits("youtube.com/shorts", "https://youtube.com/shorts/abc")).toBe(true);
    expect(hits("youtube.com/shorts", "https://youtube.com/shortstack")).toBe(false);
    expect(hits("youtube.com/shorts", "https://youtube.com/watch")).toBe(false);
  });

  it("does not match a host-only URL against a host pattern with no host", () => {
    expect(hits("example.com", "about:blank")).toBe(false);
    expect(hits("example.com", "file:///clip.mp4")).toBe(false);
  });
});

describe("findMatchingRule", () => {
  it("returns null when nothing matches", () => {
    expect(findMatchingRule("https://example.com/", [rule("other.test", 1)])).toBeNull();
  });

  it("skips disabled rules", () => {
    expect(findMatchingRule("https://example.com/", [rule("example.com", 1, false)])).toBeNull();
  });

  it("skips rules whose pattern is unparseable rather than throwing", () => {
    const good = rule("example.com", 1);
    expect(findMatchingRule("https://example.com/", [rule("ex*ample", 3), good])).toBe(good);
  });

  it("returns null for a URL it cannot parse", () => {
    expect(findMatchingRule("not a url", [rule("example.com", 1)])).toBeNull();
  });

  it("prefers the more specific host", () => {
    const broad = rule("youtube.com", 2);
    const narrow = rule("music.youtube.com", 1);
    const found = findMatchingRule("https://music.youtube.com/watch", [broad, narrow]);
    expect(found).toBe(narrow);
  });

  it("prefers an exact-host rule over a subdomain-matching one", () => {
    const loose = rule("example.com", 2);
    const exact = rule("=example.com", 1);
    expect(findMatchingRule("https://example.com/", [loose, exact])).toBe(exact);
  });

  it("prefers a deeper path when hosts are equally specific", () => {
    const site = rule("youtube.com", 2);
    const section = rule("youtube.com/shorts", 1);
    const deeper = rule("youtube.com/shorts/live", 3);
    const found = findMatchingRule("https://youtube.com/shorts/live/x", [site, section, deeper]);
    expect(found).toBe(deeper);
  });

  it("prefers a rule that names the scheme when all else is equal", () => {
    const any = rule("example.com", 2);
    const secure = rule("https://example.com", 1);
    expect(findMatchingRule("https://example.com/", [any, secure])).toBe(secure);
  });

  it("prefers a rule that names the port when all else is equal", () => {
    const any = rule("localhost", 2);
    const pinned = rule("localhost:8096", 1);
    expect(findMatchingRule("http://localhost:8096/", [any, pinned])).toBe(pinned);
  });

  it("keeps list order as the final tiebreak, so the editor is predictable", () => {
    const first = rule("example.com", 2);
    const second = rule("example.com", 3);
    expect(findMatchingRule("https://example.com/", [first, second])).toBe(first);
  });
});

describe("resolveSpeed", () => {
  it("uses the default when no rule matches", () => {
    expect(resolveSpeed("https://example.com/", [], 2)).toBe(2);
  });

  it("uses the matching rule's speed", () => {
    expect(resolveSpeed("https://example.com/", [rule("example.com", 1)], 2)).toBe(1);
  });

  it("conforms whatever the rule holds, so bad stored data cannot break playback", () => {
    expect(resolveSpeed("https://example.com/", [rule("example.com", 99)], 2)).toBe(4);
    expect(resolveSpeed("https://example.com/", [rule("example.com", Number.NaN)], 2)).toBe(2);
  });

  it("conforms the default too", () => {
    expect(resolveSpeed("https://example.com/", [], 99)).toBe(4);
    expect(resolveSpeed("not a url", [], 2)).toBe(2);
  });

  it("supports the always-1x case the site list exists for", () => {
    const rules = [rule("music.youtube.com", 1), rule("meet.google.com", 1)];
    expect(resolveSpeed("https://music.youtube.com/watch?v=1", rules, 2)).toBe(1);
    expect(resolveSpeed("https://meet.google.com/abc-def", rules, 2)).toBe(1);
    expect(resolveSpeed("https://www.youtube.com/watch?v=1", rules, 2)).toBe(2);
  });
});

describe("normalizePattern", () => {
  it("canonicalises what the user typed for storage and display", () => {
    expect(normalizePattern("  HTTPS://Example.COM./Shorts/  ")).toBe("https://example.com/Shorts");
    expect(normalizePattern("example.com")).toBe("example.com");
    expect(normalizePattern("*.example.com")).toBe("*.example.com");
    expect(normalizePattern("=example.com")).toBe("=example.com");
    expect(normalizePattern("localhost:8096")).toBe("localhost:8096");
    expect(normalizePattern("file://")).toBe("file://");
  });

  it("returns null for input that is not a usable pattern", () => {
    expect(normalizePattern("ex*ample.com")).toBeNull();
  });
});
