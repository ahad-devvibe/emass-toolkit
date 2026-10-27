import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["vitest.setup.ts"],
    // Integration files share one test DB and truncate it in beforeAll, so
    // they must run one at a time. Vitest 4 sizes workers from the CLI flag,
    // not this option alone, so maxWorkers: 1 is what actually enforces it.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
