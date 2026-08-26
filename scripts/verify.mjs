#!/usr/bin/env node
/**
 * Reproducible-build check: package twice and confirm the bytes match.
 *
 * The archive fixes every timestamp and sorts every entry, so a difference here
 * means the sources changed - not that the clock moved.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { packageExtension } from "./package.mjs";

const first = await packageExtension({ quiet: true });
const second = await packageExtension({ quiet: true });

if (first.hash !== second.hash) {
  console.error("build is not reproducible:");
  console.error(`  first  ${first.hash}`);
  console.error(`  second ${second.hash}`);
  process.exit(1);
}

const onDisk = createHash("sha256").update(await readFile(first.outPath)).digest("hex");
if (onDisk !== first.hash) {
  console.error(`the file on disk does not match what was built (${onDisk})`);
  process.exit(1);
}

console.log(`reproducible: two builds of ${first.files} files agree`);
console.log(`sha256 ${first.hash}`);
console.log(first.outPath);
