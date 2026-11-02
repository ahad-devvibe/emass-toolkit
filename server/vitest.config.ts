import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["vitest.setup.ts"],
    // Bulk mail drains without waiting between sends, so tests stay fast
    env: { EMAIL_BULK_PER_MINUTE: "60000", EMAIL_BULK_DAILY_CAP: "100000" },
    // Integration files share one test DB and truncate it in beforeAll, so
    // they must run one at a time. Vitest 4 sizes workers from the CLI flag,
    // not this option alone, so maxWorkers: 1 is what actually enforces it.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
