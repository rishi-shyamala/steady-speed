// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDiscovery, type DiscoveryOptions } from "../../src/content/discovery";
import { MediaRegistry } from "../../src/content/registry";

let stop: (() => void) | null = null;
let tasks: (() => void)[] = [];
let found: HTMLMediaElement[];
let registry: MediaRegistry;

/** Lets a test wait for the MutationObserver, which delivers asynchronously. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function start(overrides: Partial<DiscoveryOptions> = {}): void {
  registry = new MediaRegistry();
  found = [];
  stop = startDiscovery({
    document,
    registry,
    onMedia: (media) => found.push(media),
    scheduleIdle: (task) => tasks.push(task),
    ...overrides,
  });
}

function flush(): void {
  const queued = tasks;
  tasks = [];
  for (const task of queued) task();
}

function addVideo(parent: ParentNode = document.body): HTMLVideoElement {
  const video = document.createElement("video");
  parent.append(video);
  return video;
}

beforeEach(() => {
  document.body.innerHTML = "";
  tasks = [];
});

afterEach(() => {
  stop?.();
  stop = null;
});

describe("the initial sweep", () => {
  it("finds media that is already on the page", () => {
    const video = addVideo();
    start();
    expect(found).toEqual([video]);
  });

  it("finds audio as well as video", () => {
    const audio = document.createElement("audio");
    document.body.append(audio);
    start();
    expect(found).toEqual([audio]);
  });

  it("ignores everything that is not media", () => {
    document.body.innerHTML = "<div><span></span><img /></div>";
    start();
    expect(found).toEqual([]);
  });
});

describe("elements added later", () => {
  it("finds media added to the document", async () => {
    start();
    const video = addVideo();
    await tick();
    flush();
    expect(found).toEqual([video]);
  });

  it("finds media added inside a larger subtree", async () => {
    start();
    const wrapper = document.createElement("div");
    const video = document.createElement("video");
    wrapper.append(document.createElement("p"), video);
    document.body.append(wrapper);
    await tick();
    flush();
    expect(found).toEqual([video]);
  });

  it("ignores mutations that only remove nodes", async () => {
    const video = addVideo();
    start();
    video.remove();
    await tick();
    expect(tasks).toEqual([]);
  });

  it("does not schedule a second flush while one is already pending", async () => {
    start();
    addVideo();
    await tick();
    expect(tasks).toHaveLength(1);

    addVideo();
    await tick();
    expect(tasks).toHaveLength(1);

    flush();
    expect(found).toHaveLength(2);
  });

  it("ignores added nodes that are not elements", async () => {
    start();
    document.body.append(document.createTextNode("hello"));
    await tick();
    flush();
    expect(found).toEqual([]);
  });

  it("stops the shadow crawl at the node ceiling", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    addVideo(shadow);
    document.body.append(document.createElement("p"), host);

    start({ maxCrawlNodes: 1 });
    expect(found).toEqual([]);
  });

  it("batches a burst of additions into one scheduled task", async () => {
    start();
    for (let i = 0; i < 20; i += 1) addVideo();
    await tick();
    expect(tasks).toHaveLength(1);
    flush();
    expect(found).toHaveLength(20);
  });
});

describe("events", () => {
  it("finds media that announces itself before the observer flushes", async () => {
    start();
    const video = addVideo();
    video.dispatchEvent(new Event("play"));
    expect(found).toEqual([video]);

    await tick();
    flush();
    expect(found).toHaveLength(1);
  });

  it("reports each element once however many events it fires", () => {
    const video = addVideo();
    start();
    video.dispatchEvent(new Event("play"));
    video.dispatchEvent(new Event("ratechange"));
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(found).toEqual([video]);
  });

  it("catches events that do not bubble, via the capture phase", () => {
    const wrapper = document.createElement("div");
    document.body.append(wrapper);
    const video = addVideo(wrapper);
    start();
    found.length = 0;
    registry.clear();
    video.dispatchEvent(new Event("ratechange", { bubbles: false }));
    expect(found).toEqual([video]);
  });
});

describe("shadow roots", () => {
  it("finds media inside an open shadow root during the sweep", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const video = addVideo(shadow);
    start();
    expect(found).toEqual([video]);
  });

  it("finds media nested two shadow roots deep", () => {
    const outerHost = document.createElement("div");
    document.body.append(outerHost);
    const outer = outerHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    outer.append(innerHost);
    const inner = innerHost.attachShadow({ mode: "open" });
    const video = addVideo(inner);
    start();
    expect(found).toEqual([video]);
  });

  it("listens on a discovered shadow root, because media events cannot leave it", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const first = addVideo(shadow);
    start();
    expect(found).toEqual([first]);

    const second = document.createElement("video");
    shadow.append(second);
    second.dispatchEvent(new Event("play"));
    expect(found).toEqual([first, second]);
  });

  it("ignores focus on something with no shadow root", () => {
    start();
    const plain = document.createElement("div");
    document.body.append(plain);
    plain.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(found).toEqual([]);
  });

  it("ignores a focus event whose target is not an element", () => {
    start();
    document.dispatchEvent(new Event("focusin"));
    expect(found).toEqual([]);
  });

  it("follows focus into a shadow root that appeared after the sweep", () => {
    start();
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const video = addVideo(shadow);

    host.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(found).toEqual([video]);
  });

  it("registers a media element's own shadow root ancestry when it fires", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const video = addVideo(shadow);
    start();
    expect(registry.hasRoot(shadow)).toBe(true);
    expect(registry.hasMedia(video)).toBe(true);
  });
});

describe("the default scheduler", () => {
  it("uses requestIdleCallback when the browser has one", async () => {
    const calls: (() => void)[] = [];
    (globalThis as Record<string, unknown>).requestIdleCallback = (task: () => void) => {
      calls.push(task);
    };
    try {
      start({ scheduleIdle: undefined });
      addVideo();
      await tick();
      expect(calls).toHaveLength(1);
      calls[0]?.();
      expect(found).toHaveLength(1);
    } finally {
      delete (globalThis as Record<string, unknown>).requestIdleCallback;
    }
  });

  it("falls back to a timeout when it does not", async () => {
    start({ scheduleIdle: undefined });
    addVideo();
    await tick();
    await tick();
    expect(found).toHaveLength(1);
  });
});

describe("stop", () => {
  it("stops reporting media added afterwards", async () => {
    start();
    stop?.();
    stop = null;
    addVideo();
    await tick();
    flush();
    expect(found).toEqual([]);
  });

  it("stops reporting media that fires events afterwards", () => {
    const video = addVideo();
    start();
    found.length = 0;
    registry.clear();
    stop?.();
    stop = null;
    video.dispatchEvent(new Event("play"));
    expect(found).toEqual([]);
  });

  it("drops work that was already queued", async () => {
    start();
    addVideo();
    await tick();
    stop?.();
    stop = null;
    flush();
    expect(found).toEqual([]);
  });

  it("is safe to call twice", () => {
    start();
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    stop?.();
    stop?.();
    stop = null;
    expect(disconnect).toHaveBeenCalledTimes(1);
    disconnect.mockRestore();
  });
});
