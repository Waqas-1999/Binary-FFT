# Development rules

## Scope

- Build only what the current phase asks for. No speculative features, options or abstractions.
- Add features as modules inside the existing API, worker and apps. No new services
  without an explicit architectural decision.

## Brand

- Never hard-code the product name. Use `brand.name` / `brand.shortName` from `@repo/config`
  in UI, metadata, API responses, emails and logs.
- Renaming the product means editing `packages/config/src/brand.ts` only.

## Configuration and secrets

- Read environment variables only through `@repo/config/server` (validated with zod).
  Add new variables to `env.ts` and `.env.example` together.
- Never import `@repo/config/server` from Next.js client code or shared UI.
- Never prefix a secret with `NEXT_PUBLIC_`. Never commit `.env`.
- Gate unfinished or staged work with a flag in `packages/config/src/features.ts`.

## Code

- Strict TypeScript. No `any` without a comment explaining why.
- Reuse the shared packages before writing helpers: `@repo/types` for contracts,
  `@repo/validation` for schemas, `@repo/utils` for generic helpers, `@repo/ui` for components.
- Prefer Server Components. Add `"use client"` only to components that need interactivity.
- Add a dependency only when it clearly beats a few lines of code, and add its version to the
  `catalog` in `pnpm-workspace.yaml` so every workspace shares it.

## UX

- Follow [the design system](02-design-system.md): semantic tokens only, mobile-first, 44px+ touch targets.
- Plain language, generous spacing, one primary action per screen.
- Advanced controls stay hidden until the user opts in (progressive disclosure).
- Do not copy other products' UI.

## Database

- Every schema change ships as a Prisma migration (`pnpm db:migrate`).
- Select only the fields you need; avoid N+1 queries.

## Before pushing

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
