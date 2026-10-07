import { integrationTestEnv } from "./test-env.ts";

// Runs in each test worker before any test module loads, so the app's config reads the test stores.
Object.assign(process.env, integrationTestEnv());
