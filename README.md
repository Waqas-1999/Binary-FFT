# Platform monorepo

Phase 0 foundation. Start with [`docs/`](docs/00-product-overview.md).

## Requirements

- Node.js ≥ 22.18, pnpm 11
- Docker (for local PostgreSQL and Redis)

## Getting started

```sh
pnpm install
cp .env.example .env
pnpm infra:up          # PostgreSQL :5432, Redis :6379
pnpm dev               # web :3000, admin :3001, api :4000, worker
```

Health check: http://localhost:4000/api/v1/health

Signup verification emails are sent through SMTP. Set `SMTP_HOST`, `SMTP_FROM`, and
the SMTP port/security settings in `.env`; if your server requires authentication, also
set `SMTP_USER` and `SMTP_PASSWORD`. With no SMTP host, development emails are only
written to the API log and are not delivered. Production startup requires SMTP to be configured.

## Scripts

| Command          | Purpose                                  |
| ---------------- | ---------------------------------------- |
| `pnpm dev`       | Run every app and service in watch mode  |
| `pnpm build`     | Build everything                         |
| `pnpm typecheck` | Type-check every workspace               |
| `pnpm lint`      | Lint the repository                      |
| `pnpm test`      | Unit + integration tests (needs `infra:up`) |
| `pnpm db:migrate`| Create/apply Prisma migrations           |
| `pnpm infra:down`| Stop local PostgreSQL and Redis          |
