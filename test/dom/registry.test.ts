// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { MediaRegistry } from "../../src/content/registry";

let registry: MediaRegistry;

beforeEach(() => {
  registry = new MediaRegistry();
  document.body.innerHTML = "";
});

function video(): HTMLVideoElement {
  const element = document.createElement("video");
  document.body.append(element);
  return element;
}

describe("media", () => {
  it("reports the first add as new and the second as not", () => {
    const element = video();
    expect(registry.addMedia(element)).toBe(true);
    expect(registry.addMedia(element)).toBe(false);
  });

  it("answers membership questions", () => {
    const known = video();
    const unknown = video();
    registry.addMedia(known);
    expect(registry.hasMedia(known)).toBe(true);
    expect(registry.hasMedia(unknown)).toBe(false);
  });

  it("counts and visits what it holds, in the order it was found", () => {
    const first = video();
    const second = video();
    registry.addMedia(first);
    registry.addMedia(second);

    expect(registry.mediaCount).toBe(2);
    const visited: HTMLMediaElement[] = [];
    registry.forEachMedia((media) => visited.push(media));
    expect(visited).toEqual([first, second]);
  });
});

describe("roots", () => {
  it("tracks event roots the same way", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });

    expect(registry.addRoot(document)).toBe(true);
    expect(registry.addRoot(shadow)).toBe(true);
    expect(registry.addRoot(shadow)).toBe(false);
    expect(registry.hasRoot(shadow)).toBe(true);

    const visited: unknown[] = [];
    registry.forEachRoot((root) => visited.push(root));
    expect(visited).toEqual([document, shadow]);
  });
});

describe("clear", () => {
  it("forgets both media and roots", () => {
    const element = video();
    registry.addMedia(element);
    registry.addRoot(document);
    registry.clear();

    expect(registry.mediaCount).toBe(0);
    expect(registry.hasMedia(element)).toBe(false);
    expect(registry.hasRoot(document)).toBe(false);
  });
});
