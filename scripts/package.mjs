#!/usr/bin/env node
/** Builds, guards, and writes a signing-ready .xpi with a hash you can check. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./zip.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function collect(dir, prefix = "") {
  const entries = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    const name = prefix === "" ? item.name : `${prefix}/${item.name}`;
    if (item.isDirectory()) entries.push(...(await collect(path, name)));
    else entries.push({ name, data: await readFile(path) });
  }
  return entries;
}

export async function packageExtension({ quiet = false } = {}) {
  execFileSync("node", [resolve(root, "scripts/build.mjs")], { stdio: quiet ? "ignore" : "inherit" });
  execFileSync("node", [resolve(root, "scripts/guard.mjs")], { stdio: quiet ? "ignore" : "inherit" });

  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const entries = await collect(resolve(root, "dist/firefox"));
  const archive = createZip(entries);

  const outDir = resolve(root, "dist");
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, `steady-${pkg.version}.xpi`);
  await writeFile(outPath, archive);

  const hash = createHash("sha256").update(archive).digest("hex");
  return { outPath, hash, bytes: archive.length, files: entries.length };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const result = await packageExtension();
  console.log(`\npackaged ${result.files} files -> ${result.outPath}`);
  console.log(`${result.bytes} bytes`);
  console.log(`sha256 ${result.hash}`);
}
