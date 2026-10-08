import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // The first test in a file pays for loading React and the UI package; under the CPU contention of a
    // full monorepo run (api integration tests alongside) that can pass 5 seconds without anything being wrong.
    testTimeout: 15_000,
  },
});
