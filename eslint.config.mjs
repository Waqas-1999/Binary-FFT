import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const nextApps = ["apps/web", "apps/admin"];
// React, hooks and accessibility rules from the Next.js config also apply to the shared UI package.
const reactSources = [...nextApps, "packages/ui"];

export default defineConfig(
  globalIgnores(["**/dist/", "**/.next/", "**/.turbo/", "**/generated/", "**/next-env.d.ts"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  nextVitals.map((config) => ({ ...config, files: reactSources.map((dir) => `${dir}/**/*.{ts,tsx,mjs}`) })),
  { settings: { next: { rootDir: nextApps } } },
);
