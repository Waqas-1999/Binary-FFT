import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts"],
        },
      },
      {
        // Needs PostgreSQL and Redis (`pnpm infra:up`); uses isolated test stores.
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          globalSetup: ["./src/test/global-setup.ts"],
          setupFiles: ["./src/test/setup-integration-env.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
