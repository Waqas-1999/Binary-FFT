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

## Scripts

| Command          | Purpose                                  |
| ---------------- | ---------------------------------------- |
| `pnpm dev`       | Run every app and service in watch mode  |
| `pnpm build`     | Build everything                         |
| `pnpm typecheck` | Type-check every workspace               |
| `pnpm lint`      | Lint the repository                      |
| `pnpm test`      | Run unit tests                           |
| `pnpm db:migrate`| Create/apply Prisma migrations           |
| `pnpm infra:down`| Stop local PostgreSQL and Redis          |
