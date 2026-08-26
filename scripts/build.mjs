#!/usr/bin/env node
/**
 * Build the extension. No minification: the shipped bundle is meant to be read.
 */
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest } from "./manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = {
  firefox: { esbuildTarget: ["firefox128"], outDir: "dist/firefox" },
  chromium: { esbuildTarget: ["chrome120"], outDir: "dist/chromium" },
};

const ENTRY_POINTS = {
  content: "src/content/index.entry.ts",
  background: "src/background/index.entry.ts",
  "page-agent": "src/page/agent.entry.ts",
  popup: "src/popup/index.entry.ts",
  options: "src/options/index.ts",
};

async function main() {
  const targetArg = process.argv.find((a) => a.startsWith("--target="));
  const target = targetArg ? targetArg.split("=")[1] : "firefox";
  const config = TARGETS[target];
  if (!config) throw new Error(`Unknown target: ${target}`);

  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const outDir = resolve(root, config.outDir);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const entryPoints = Object.fromEntries(
    Object.entries(ENTRY_POINTS).map(([name, file]) => [name, resolve(root, file)]),
  );

  await build({
    entryPoints,
    outdir: outDir,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: config.esbuildTarget,
    minify: false,
    sourcemap: false,
    treeShaking: true,
    legalComments: "inline",
    charset: "utf8",
    logLevel: "warning",
  });

  await cp(resolve(root, "static"), outDir, { recursive: true });

  const manifest = buildManifest({ target, version: pkg.version });
  await writeFile(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`built ${target} -> ${config.outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
