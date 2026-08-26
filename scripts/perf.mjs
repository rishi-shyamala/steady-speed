#!/usr/bin/env node
/**
 * What the extension costs a page, measured rather than asserted.
 *
 * Every figure is a difference: the same scenario is run in two browsers, one
 * with the extension loaded and one without, and the gap between them is the
 * extension's cost. Absolute numbers from a container are meaningless; a
 * difference measured back to back is not.
 *
 * Writes docs/perf.md and exits non-zero if a budget is exceeded.
 */
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pagesDir = resolve(root, "test/e2e/pages");
const extension = resolve(root, "dist/chromium");

/** Budgets, in the units each measurement reports. */
const BUDGETS = {
  loadCostMs: 30,
  idleCostMs: 15,
  stormCostMs: 120,
  insertionP95Ms: 400,
  contentBytes: 40 * 1024,
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".webm": "video/webm",
};

async function main() {
  execFileSync("node", [resolve(root, "scripts/build.mjs"), "--target=chromium"], { stdio: "ignore" });
  execFileSync("node", [resolve(root, "scripts/build.mjs")], { stdio: "ignore" });

  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;

  const withExt = await launch(true);
  const without = await launch(false);

  try {
    const load = await compare(withExt, without, origin, measureLoad);
    const idle = await compare(withExt, without, origin, measureIdle);
    const storm = await compare(withExt, without, origin, measureStorm);
    const insertion = await measureInsertion(withExt, origin);
    const atPlay = await measureAtPlay(withExt, origin);
    const sizes = await bundleSizes();

    const report = {
      loadCostMs: round(load),
      idleCostMs: round(idle),
      stormCostMs: round(storm),
      insertionMedianMs: round(median(insertion)),
      insertionP95Ms: round(percentile(insertion, 95)),
      rateCorrectAtPlay: atPlay.every((rate) => rate === 2),
      sizes,
    };

    const failures = checkBudgets(report, sizes);
    await writeFile(resolve(root, "docs/perf.md"), renderReport(report, failures));

    console.log(renderConsole(report, failures));
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    await withExt.close();
    await without.close();
    await new Promise((done) => server.close(done));
  }
}

async function launch(loadExtension) {
  const profile = await mkdtemp(join(tmpdir(), "steady-perf-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: loadExtension
      ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
      : [],
  });
  return {
    context,
    async close() {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    },
  };
}

/** Runs the same scenario in both browsers and returns the difference in ms. */
async function compare(withExt, without, origin, scenario) {
  const a = await scenario(withExt, origin);
  const b = await scenario(without, origin);
  return a - b;
}

async function scriptMs(page, run) {
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const before = await metric(client, "ScriptDuration");
  await run();
  const after = await metric(client, "ScriptDuration");
  await client.detach();
  return (after - before) * 1000;
}

async function metric(client, name) {
  const { metrics } = await client.send("Performance.getMetrics");
  return metrics.find((entry) => entry.name === name)?.value ?? 0;
}

/** Cost of loading a ten-thousand-node page with a player on it. */
async function measureLoad({ context }, origin) {
  let total = 0;
  for (let i = 0; i < 5; i += 1) {
    const page = await context.newPage();
    const client = await page.context().newCDPSession(page);
    await client.send("Performance.enable");
    await page.goto(`${origin}/heavy.html`);
    await page.waitForTimeout(600);
    total += (await metric(client, "ScriptDuration")) * 1000;
    await client.detach();
    await page.close();
  }
  return total / 5;
}

/** Cost of ten seconds of a page sitting there with a player playing. */
async function measureIdle({ context }, origin) {
  const page = await context.newPage();
  await page.goto(`${origin}/plain.html`);
  await page.waitForTimeout(800);
  await page.$eval("#player", (element) => element.play());
  const cost = await scriptMs(page, () => page.waitForTimeout(10_000));
  await page.close();
  return cost;
}

/** Cost of five seconds of a thousand nodes a second being added and removed. */
async function measureStorm({ context }, origin) {
  const page = await context.newPage();
  await page.goto(`${origin}/storm.html`);
  await page.waitForTimeout(600);
  const cost = await scriptMs(page, () => page.evaluate(() => window.runStorm(5_000, 50)));
  await page.close();
  return cost;
}

/** How long after inserting a player it reaches the target speed. */
async function measureInsertion({ context }, origin) {
  const page = await context.newPage();
  await page.goto(`${origin}/latency.html`);
  await page.waitForTimeout(600);
  const samples = await page.evaluate(() => window.measureInsertion(25));
  await page.close();
  return samples;
}

/** Whether the speed is already right by the time playback actually starts. */
async function measureAtPlay({ context }, origin) {
  const page = await context.newPage();
  await page.goto(`${origin}/latency.html`);
  await page.waitForTimeout(600);
  const rates = await page.evaluate(() => window.measureAtPlay(5));
  await page.close();
  return rates;
}

async function bundleSizes() {
  const dir = resolve(root, "dist/firefox");
  const sizes = {};
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".js"))) {
    sizes[name] = (await stat(join(dir, name))).size;
  }
  return sizes;
}

function checkBudgets(report, sizes) {
  const failures = [];
  for (const [key, budget] of Object.entries(BUDGETS)) {
    if (key === "contentBytes") continue;
    if (report[key] > budget) failures.push(`${key} was ${report[key]}, budget ${budget}`);
  }
  if (sizes["content.js"] > BUDGETS.contentBytes) {
    failures.push(`content.js was ${sizes["content.js"]} bytes, budget ${BUDGETS.contentBytes}`);
  }
  if (!report.rateCorrectAtPlay) failures.push("the speed was not already correct when playback started");
  return failures;
}

function renderReport(report, failures) {
  const sizeRows = Object.entries(report.sizes)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, bytes]) => `| \`${name}\` | ${bytes.toLocaleString()} |`)
    .join("\n");

  return `# Measured cost

Generated by \`npm run perf\`. Every timing is a **difference**: the same scenario
run in Chromium with the extension loaded, minus the same scenario without it.
Absolute numbers from a container mean nothing; a difference measured back to
back does. Firefox will differ in magnitude, not in shape.

| Scenario | Extension's share of main-thread script time |
| --- | --- |
| Loading a 10,000-node page with a player (mean of 5) | **${report.loadCostMs} ms** |
| Ten seconds of a page sitting there, player playing | **${report.idleCostMs} ms** |
| Five seconds of ~1,000 nodes/second being added and removed | **${report.stormCostMs} ms** |

| Discovery | |
| --- | --- |
| Inserted player reaches the target speed, median | ${report.insertionMedianMs} ms |
| Inserted player reaches the target speed, 95th percentile | ${report.insertionP95Ms} ms |
| Speed already correct when playback starts | ${report.rateCorrectAtPlay ? "yes, every time" : "**no**"} |

The insertion figure is bounded by \`requestIdleCallback\`, which is deliberate:
a player that is inserted and never played does not need the rate set urgently.
What matters is the row below it — the rate is always right *before* playback
starts, because \`play\`, \`playing\`, \`canplay\` and \`loadedmetadata\` are all
caught synchronously in the capture phase.

| Shipped file | Bytes (unminified) |
| --- | --- |
${sizeRows}

${failures.length === 0 ? "All budgets met." : `## Budgets missed\n\n${failures.map((line) => `- ${line}`).join("\n")}`}
`;
}

function renderConsole(report, failures) {
  const lines = [
    `load    ${report.loadCostMs} ms`,
    `idle    ${report.idleCostMs} ms`,
    `storm   ${report.stormCostMs} ms`,
    `insert  median ${report.insertionMedianMs} ms, p95 ${report.insertionP95Ms} ms`,
    `at play ${report.rateCorrectAtPlay ? "correct" : "WRONG"}`,
  ];
  if (failures.length > 0) lines.push("", "budgets missed:", ...failures.map((line) => `  - ${line}`));
  return lines.join("\n");
}

async function serve() {
  const server = createServer((request, response) => {
    const name = (request.url ?? "/").split("?")[0].replace(/^\/+/, "") || "plain.html";
    const path = join(pagesDir, name);
    void stat(path)
      .then(() => {
        response.writeHead(200, { "content-type": CONTENT_TYPES[extname(path)] ?? "text/plain" });
        createReadStream(path).pipe(response);
      })
      .catch(() => response.writeHead(404).end());
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  return server;
}

const round = (value) => Math.round(value * 10) / 10;
const median = (values) => percentile(values, 50);

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

await main();
