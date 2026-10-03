# Product overview

**BINERY FTT** is a financial trading web platform. The brand name is defined once in
`packages/config/src/brand.ts`; this document is the only other place it is written.

## Principles

1. Extremely simple, beginner-friendly UX. The default experience should feel obvious and minimal.
2. Advanced functionality uses progressive disclosure: hidden until the user asks for it.
3. Mobile-first, with large touch targets, simple language and low visual noise.
4. Fast: small JavaScript bundles, server rendering where appropriate, few dependencies.
5. Simple architecture: one API, one worker, no microservices.

## Applications

| App              | Audience  | Purpose                                     |
| ---------------- | --------- | ------------------------------------------- |
| `apps/web`       | Customers | The customer-facing product.                |
| `apps/admin`     | Staff     | Future administrative control center.       |
| `services/api`   | Both apps | Modular backend (HTTP now, WebSocket later). |
| `services/worker`| Internal  | Background jobs (BullMQ).                   |

## Current phase: Phase 0 (foundation)

Phase 0 delivers only the development foundation: workspace, configuration, database and
Redis connectivity, health checks and empty app shells.

Explicitly **not** built yet: authentication, signup/login, trading, market data, charts,
wallet, payments, withdrawals, referrals, affiliates, promotions, blog, FAQ, support, KYC,
VIP, risk engine and settlement. These arrive in later phases.
