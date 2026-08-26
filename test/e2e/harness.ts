/**
 * A real browser, a real extension, real `<video>` elements.
 *
 * The environment this project is built in has no Firefox binary, so the
 * end-to-end pass runs against Chromium with a Chromium manifest generated from
 * the same source. It exercises everything above the browser-specific line:
 * injection, discovery, enforcement, escalation, the popup, and storage. What it
 * cannot cover is listed in docs/manual-firefox-checklist.md.
 */
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Worker } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const pagesDir = resolve(here, "pages");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".webm": "video/webm",
  ".js": "text/javascript; charset=utf-8",
};

export interface Harness {
  context: BrowserContext;
  origin: string;
  extensionId: string;
  /** Writes straight into the extension's own storage, as the options page would. */
  seedStorage(items: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  execFileSync("node", [resolve(root, "scripts/build.mjs"), "--target=chromium"], {
    stdio: "ignore",
  });

  const server = await serveFixtures();
  const profile = await mkdtemp(join(tmpdir(), "steady-e2e-"));
  const extension = resolve(root, "dist/chromium");

  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });

  const worker = await waitForWorker(context);
  const extensionId = new URL(worker.url()).host;

  return {
    context,
    origin: `http://127.0.0.1:${port(server)}`,
    extensionId,
    async seedStorage(items) {
      await worker.evaluate(
        async (payload: Record<string, unknown>) =>
          (globalThis as unknown as { chrome: { storage: { local: { set(v: unknown): Promise<void> } } } }).chrome.storage.local.set(
            payload,
          ),
        items,
      );
    },
    async close() {
      await context.close();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(profile, { recursive: true, force: true });
    },
  };
}

async function waitForWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent("serviceworker", { timeout: 15_000 });
}

function port(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server has no port");
  return address.port;
}

async function serveFixtures(): Promise<Server> {
  const server = createServer((request, response) => {
    const name = (request.url ?? "/").split("?")[0]?.replace(/^\/+/, "") || "plain.html";
    if (name.includes("..")) {
      response.writeHead(400).end();
      return;
    }
    const path = join(pagesDir, name);
    void stat(path)
      .then(() => {
        response.writeHead(200, {
          "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
        });
        createReadStream(path).pipe(response);
      })
      .catch(() => response.writeHead(404).end());
  });

  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return server;
}
