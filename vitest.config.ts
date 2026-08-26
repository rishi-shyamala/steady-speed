import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        "src/core/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "src/platform/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "src/content/**": { branches: 95, functions: 95, lines: 95, statements: 95 },
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
