import { defineConfig } from "vitest/config";

/**
 * The end-to-end pass. Separate from `npm test` because it builds the extension
 * and drives a real browser, which is slow and needs a Chromium binary present.
 */
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    expect: { poll: { timeout: 15_000, interval: 100 } },
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
