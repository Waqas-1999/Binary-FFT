# Architecture

A pnpm + Turborepo monorepo. Everything is TypeScript (strict) and ES modules.

```
apps/
  web/            Next.js (App Router) customer app          :3000
  admin/          Next.js (App Router) admin shell           :3001
services/
  api/            NestJS modular API                         :4000
  worker/         BullMQ worker process
packages/
  config/         brand, feature flags, server env/config
  types/          shared TypeScript types (API contracts)
  validation/     zod + shared validation helpers
  ui/             React components + Tailwind design tokens
  utils/          small framework-free helpers
prisma/           Prisma schema (PostgreSQL) and future migrations
infrastructure/   Docker Compose for local PostgreSQL + Redis
docs/
```

## Runtime

```
browser ──> web / admin (Next.js, SSR/static) ──> api (NestJS) ──> PostgreSQL (Prisma)
                                                      │
                                                      └──> Redis <── worker (BullMQ)
```

- **API** (`services/api`): routes are prefixed `/api` and URI-versioned (`/api/v1/...`).
  Modules: `config`, `database` (Prisma), `redis`, `health`. New features are added as
  NestJS modules under `src/`, not as new services.
- **Worker** (`services/worker`): one process hosting BullMQ workers. Processors are
  registered in `src/workers.ts` (none in Phase 0).
- **Realtime**: future WebSocket traffic will be served by the API (NestJS gateways), using
  Redis for cross-instance fan-out. Nothing is built yet.

## Configuration

| Concern  | Location                                       | Browser-safe |
| -------- | ---------------------------------------------- | ------------ |
| Brand    | `packages/config/src/brand.ts`                 | yes          |
| Features | `packages/config/src/features.ts`              | yes          |
| Env vars | `packages/config/src/server/env.ts` (zod)      | **no**       |
| App      | `packages/config/src/server/app.ts`            | **no**       |
| Database | `packages/config/src/server/database.ts`       | **no**       |
| Redis    | `packages/config/src/server/redis.ts`          | **no**       |

- `@repo/config` exports only browser-safe values. `@repo/config/server` reads secrets
  and must only be imported by the API and worker.
- Environment variables are validated once at startup; invalid configuration stops the
  process with a list of every bad variable.
- Local development reads a single root `.env` (copy `.env.example`). Next.js only exposes
  `NEXT_PUBLIC_*` variables to the browser; never give secrets that prefix.

## API conventions

- **Errors**: every error returns `ApiErrorResponse` (`@repo/types`) via a global filter.
  Unexpected errors return a generic 500 and are logged with the stack.
- **Validation**: request input is validated with shared zod schemas through
  `ZodValidationPipe`. Failures return 400 with `issues`.
- **Logging**: NestJS `ConsoleLogger` in JSON mode. Each request logs method, path, status,
  duration and a request id (`x-request-id`, echoed in responses and error bodies).
- **Health**: `GET /api/v1/health` checks PostgreSQL and Redis (2s timeout each). It returns
  200 when everything is up, 503 when degraded.

## Database

- Prisma 7 with the `prisma-client` generator and the `@prisma/adapter-pg` driver adapter.
- The schema lives in `prisma/schema.prisma`; `prisma.config.ts` (root) supplies the URL.
- The client is generated into `services/api/src/generated/prisma` (gitignored) by the
  root `db:generate` task, which Turborepo runs before API build/dev/test.
- Phase 0 defines no models.

## Build pipeline

- Shared packages compile with `tsc` to `dist/`; Turborepo builds dependencies first (`^build`).
- Node-side code imports relative files with `.ts` extensions; `rewriteRelativeImportExtensions`
  rewrites them on emit, and the worker runs its sources directly in dev via Node type stripping.
- The API builds with the Nest CLI (decorator metadata requires `tsc`).
- Next.js apps use Turbopack and Tailwind CSS v4. Design tokens are shared from
  `@repo/ui/styles.css`. The system font stack avoids font downloads.
