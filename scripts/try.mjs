#!/usr/bin/env node
/**
 * Launch Zen (or Firefox) with this build temporarily installed, over a local
 * server of the same fixture pages the end-to-end suite uses.
 *
 * This is the manual pass from docs/manual-firefox-checklist.md made one
 * command. Nothing here ships: `web-ext` is fetched by `npx` only when you run
 * it, exactly as in docs/SIGNING.md.
 *
 *   npm run try                 # Zen if it is installed, else Firefox
 *   npm run try -- --browser=firefox
 *   npm run try -- --serve      # just the fixture server, no browser
 */
import { execFileSync, spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pagesDir = resolve(root, "test/e2e/pages");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".webm": "video/webm",
  ".js": "text/javascript; charset=utf-8",
};

/** Where each browser lives, most specific first. */
const BROWSERS = {
  zen: ["/usr/bin/zen-browser", "/usr/bin/zen", "/var/lib/flatpak/exports/bin/app.zen_browser.zen"],
  firefox: ["/usr/bin/firefox", "/usr/bin/firefox-developer-edition"],
};

function flag(name) {
  const found = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!found) return undefined;
  return found.includes("=") ? found.split("=").slice(1).join("=") : "";
}

function findBrowser(preferred) {
  const order = preferred ? [preferred] : ["zen", "firefox"];
  for (const name of order) {
    const candidates = BROWSERS[name];
    if (!candidates) throw new Error(`Unknown browser: ${name} (try zen or firefox)`);
    const hit = candidates.find((path) => existsSync(path));
    if (hit) return { name, path: hit };
  }
  throw new Error(`No binary found for: ${order.join(", ")}`);
}

async function index() {
  const files = (await readdir(pagesDir)).filter((f) => f.endsWith(".html")).sort();
  const items = files.map((f) => `<li><a href="/${f}">${f}</a></li>`).join("\n      ");
  return `<!doctype html>
<meta charset="utf-8">
<title>Steady fixtures</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
  li { margin: .25rem 0; }
</style>
<h1>Steady fixtures</h1>
<p>The same pages the end-to-end suite drives. Open one and check the speed the
popup reports against what the player is doing.</p>
<ul>
      ${items}
</ul>
<p>The full manual pass is in <code>docs/manual-firefox-checklist.md</code>.</p>
`;
}

async function serveFixtures() {
  const server = createServer((request, response) => {
    const name = (request.url ?? "/").split("?")[0].replace(/^\/+/, "");
    if (name.includes("..")) {
      response.writeHead(400).end();
      return;
    }
    if (name === "" || name === "index.html") {
      void index().then((html) => {
        response.writeHead(200, { "content-type": CONTENT_TYPES[".html"] }).end(html);
      });
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
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  return server;
}

const browserArg = flag("browser");
const serveOnly = flag("serve") !== undefined;

execFileSync("node", [resolve(root, "scripts/build.mjs")], { stdio: "inherit" });

const server = await serveFixtures();
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`\nfixtures at ${origin}`);

if (serveOnly) {
  console.log("serving only; ctrl-c to stop");
} else {
  const browser = findBrowser(browserArg || undefined);
  console.log(`launching ${browser.name} (${browser.path}) with dist/firefox installed temporarily\n`);

  const child = spawn(
    "npx",
    [
      "--yes",
      "web-ext",
      "run",
      "--source-dir",
      resolve(root, "dist/firefox"),
      "--firefox",
      browser.path,
      "--start-url",
      `${origin}/`,
      "--browser-console",
    ],
    { cwd: root, stdio: "inherit" },
  );

  child.on("exit", (code) => {
    server.close();
    process.exit(code ?? 0);
  });
}

process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
