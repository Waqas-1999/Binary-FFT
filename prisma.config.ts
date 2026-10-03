import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma does not load .env files itself; local development reads the root .env.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Optional so `prisma generate` works without a database (e.g. in CI builds).
  datasource: { url: process.env.DATABASE_URL },
});
