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
- Models: `User`, `EmailAccount`, `EmailVerificationToken`, `Session`, `AuthEvent` (see below).
- Integration tests use the `<db>_test` database and Redis DB 15, applied with `prisma migrate deploy`.

## Identity and authentication

- **User**: UUID v7 primary key plus a public `userNumber` (10000, 10001, …). It's a PostgreSQL
  `GENERATED ALWAYS AS IDENTITY` column, so values are concurrency-safe, never reused, and can't
  be supplied by callers; a trigger makes it immutable. Never use it as a foreign key.
- **EmailAccount**: normalized email (unique) + Argon2id hash (19 MiB, t=2, p=1).
- **Signup** (`POST /api/v1/auth/signup`) creates an unverified account and emails a link. The
  response is identical for new and existing addresses (existing verified owners get an "account
  exists" email instead). No session is created.
- **Verification** (`POST /api/v1/auth/verify-email`): 256-bit single-use token, only its SHA-256
  hash is stored, valid for 24 h, claimed atomically. The link carries it in the URL fragment
  (`/verify-email#token=…`), which never reaches server logs, and the page requires a click so
  email scanners can't consume it. Success signs the user in.
- **Login** (`POST /api/v1/auth/login`): one generic error for unknown email, wrong password and
  disabled accounts, with dummy-hash timing equalization. Unverified accounts get
  `EMAIL_NOT_VERIFIED` (only after the password is proven) and a fresh link.
- **Sessions**: opaque 256-bit token in an HttpOnly, SameSite=Lax cookie (`__Host-session`,
  Secure, in production); the database stores only its SHA-256 hash. 30-day absolute lifetime,
  7-day idle timeout, `last_active_at` written at most every 5 minutes. Logout
  (`POST /api/v1/auth/logout`) revokes server-side. `GET /api/v1/auth/session` returns the user.
- **Guard**: put `@Authenticated()` on a controller or route and read `@CurrentAuth()`
  (`{ userId, sessionId }`). Import `AuthModule` in the feature module.
- **CSRF**: SameSite=Lax cookies plus `OriginGuard`, which rejects state-changing requests whose
  `Origin`/`Referer` is not `WEB_APP_URL` or `API_CORS_ORIGINS`.
- **Rate limits** (Redis, fixed window, fail closed): signup, login per IP, failed logins per
  email, verification per IP, resend per IP, and a silent cap on emails per address. Values live in
  `services/api/src/auth/auth.config.ts`; the password policy in `@repo/validation`.
- **Audit**: `auth_events` records signup, verification, login success/failure and logout with
  IP and user agent. Never passwords, hashes or tokens.
- **Email**: `EmailService` (templates) → `EMAIL_SENDER` (direct SMTP via nodemailer, or a
  development log adapter). Delivery logs include masked recipient and safe transport/error
  metadata; message bodies and verification tokens are never logged. Verification email failures
  keep signup/resend responses generic and remove the unsent token.
- **Web**: the browser calls the API same-origin through the Next.js `/api/*` rewrite
  (`API_INTERNAL_URL`, read at build time). `useAuth()` in `apps/web/lib/auth.ts` exposes
  `loading` / `authenticated` / `unauthenticated`; nothing auth-related is stored in localStorage.

### Production requirement: client IPs

Per-IP rate limits need the real client IP. The Next.js `/api/*` rewrite forwards a
client-supplied `X-Forwarded-For` unchanged and does not add the client's address, so the API
must not trust it. Auth does not work around this; it is a deployment concern.

- **Now (development, no edge proxy):** `API_TRUST_PROXY=false`. All requests proxied through the
  web server share one IP, so per-IP limits behave as global limits.
- **Production topology:** an edge proxy or load balancer terminates TLS and routes `/api/*`
  directly to the API and everything else to the web app. It must overwrite (or append to)
  `X-Forwarded-For`; only then set `API_TRUST_PROXY` to the number of trusted hops (e.g. `1`).
- Keep `API_TRUST_PROXY=false` until that edge is deployed and verified.

### Email delivery

SMTP settings (`SMTP_*`, including the sender in `SMTP_FROM`) are validated once at startup in
`@repo/config/server`. In production the API refuses to start without `SMTP_HOST` and
`SMTP_FROM`, or with only one of `SMTP_USER`/`SMTP_PASSWORD`. Transport is always encrypted:
implicit TLS (`SMTP_SECURE=true`, port 465) or mandatory STARTTLS (port 587), TLS 1.2+, with
certificate verification. Credentials are never logged. Messages are plain text for now; HTML
templates belong to the later notification layer.

## Build pipeline

- Shared packages compile with `tsc` to `dist/`; Turborepo builds dependencies first (`^build`).
- Node-side code imports relative files with `.ts` extensions; `rewriteRelativeImportExtensions`
  rewrites them on emit, and the worker runs its sources directly in dev via Node type stripping.
- The API builds with the Nest CLI (decorator metadata requires `tsc`).
- Next.js apps use Turbopack and Tailwind CSS v4. Design tokens are shared from
  `@repo/ui/styles.css`. The system font stack avoids font downloads.
