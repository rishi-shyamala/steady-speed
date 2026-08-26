#!/usr/bin/env node
/** Prints exactly what is trusted at build time, and asserts nothing ships. */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const runtime = Object.keys(pkg.dependencies ?? {});

console.log(`runtime dependencies: ${runtime.length === 0 ? "none" : runtime.join(", ")}`);
if (runtime.length > 0) {
  console.error("FAIL: this extension must ship zero runtime dependencies.");
  process.exit(1);
}
console.log("\nbuild-time dependency tree:\n");
console.log(execFileSync("npm", ["ls", "--all", "--include=dev"], { encoding: "utf8" }));
