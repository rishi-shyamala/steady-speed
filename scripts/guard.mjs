#!/usr/bin/env node
/** Fails the build if the shipped artifact breaks the extension's own rules. */
import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FORBIDDEN_PERMISSIONS } from "./manifest.mjs";
import {
  findForbiddenIdentifiers,
  findForbiddenPatterns,
  findForbiddenPermissions,
} from "./guard-lib.mjs";

const MAX_BYTES = 25 * 1024;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist/firefox");

/** @type {string[]} */
const failures = [];

const files = await readdir(distDir, { recursive: true });
const scripts = files.filter((f) => f.endsWith(".js"));
if (scripts.length === 0) failures.push("no built scripts found - run `npm run build` first");

let totalBytes = 0;
for (const file of scripts) {
  const source = await readFile(resolve(distDir, file), "utf8");
  totalBytes += Buffer.byteLength(source);
  for (const id of findForbiddenIdentifiers(source)) {
    failures.push(`${file}: forbidden identifier \`${id}\``);
  }
  for (const name of findForbiddenPatterns(source)) {
    failures.push(`${file}: forbidden pattern \`${name}\``);
  }
}

const manifest = JSON.parse(await readFile(resolve(distDir, "manifest.json"), "utf8"));
for (const perm of findForbiddenPermissions(manifest, FORBIDDEN_PERMISSIONS)) {
  failures.push(`manifest.json: forbidden permission \`${perm}\``);
}

if (totalBytes > MAX_BYTES) {
  failures.push(`shipped JS is ${totalBytes} bytes, budget is ${MAX_BYTES}`);
}

if (failures.length > 0) {
  console.error("guard failed:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log(`guard passed: ${scripts.length} scripts, ${totalBytes} bytes (budget ${MAX_BYTES})`);
