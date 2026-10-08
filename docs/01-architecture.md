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

### Password recovery

- `POST /api/v1/auth/forgot-password` always returns `202 {status: "reset_pending"}`. Whether the
  address exists, is verified or is disabled is never revealed, and the work that differs (lookup,
  token, SMTP) runs after the response so timing doesn't reveal it either. Only verified, active
  password accounts get an email. Limits: 5 requests per IP per hour (fail closed if Redis is down),
  and a silent cap of 3 reset emails per address per hour.
- The token is 256-bit, single-use and valid for 1 hour; only its SHA-256 hash is stored
  (`password_reset_tokens`). The link is `/reset-password#token=…`: the fragment never reaches
  servers, logs or referrers, and the page needs an explicit "Update password" click, so scanners
  that open the link cannot consume it.
- `POST /api/v1/auth/reset-password` checks the shared password policy (including the
  email-in-password rule) *before* consuming anything, then, in one transaction, claims the token,
  replaces the Argon2id hash, invalidates the user's other reset links and **revokes every
  session**. Concurrent attempts with one token cannot both succeed. The user is not signed in;
  they sign in again. Limit: 10 submissions per IP per 15 minutes. Disabled users cannot reset.

### Google sign-in and account linking

Standard OAuth 2.0 authorization-code flow with PKCE, run on the server. Identity is Google's
stable `sub`, stored in `o_auth_identities` (`provider`, `provider_subject`, `email_at_link_time`).
`(provider, provider_subject)` is unique, so one Google account belongs to one user;
`(user_id, provider)` is unique, so a user has at most one identity per provider while the table
and `OAuthProvider` enum stay open to other providers. Email is used only to detect a conflicting
password account, never as identity. Only an ID token is requested (`openid email`): signature,
issuer, audience, expiry, nonce and `email_verified` are checked, then it is discarded. No Google
access or refresh tokens are stored.

- `GET /api/v1/auth/google?next=` starts sign-in. `GET /api/v1/auth/google/callback` finishes both
  sign-in and linking. `POST /api/v1/auth/google/link` (signed in) starts linking and returns the
  Google URL; it is a POST so the origin check applies and no third-party page can start it.
- **State**: 256-bit random, held in Redis as a hash for 10 minutes together with the PKCE verifier,
  nonce, purpose and allowlisted return path. Consumed atomically (`GETDEL`), so replay and
  concurrent use fail; consumed even when the browser binding is wrong. Each flow is bound to the
  starting browser by an HttpOnly `oauth-binding` cookie (`__Host-` in production), which defeats
  login CSRF and code injection.
- **Redirects**: after sign-in the browser goes to `WEB_APP_URL` + an exact-match allowlisted route
  (`/trade`, `/activity`, `/wallet`, `/profile`); anything else becomes `/trade`. Failures redirect
  to `/login?error=` or `/profile?google=` with fixed codes, never details.
- **Sign-in**: an existing identity signs into its user; a new one creates a `User` (normal
  `userNumber`) plus the identity and **no** `EmailAccount` and no password. Then the usual session
  (`session` cookie, hashed token, same lifetime and revocation). Disabled users are refused.
- **Never auto-linked**: if a *verified* password account already uses the Google email, sign-in is
  refused with `oauth_account_exists` ("sign in with your email, then connect Google from your
  profile"). Nothing is merged or moved. An unverified password account is left untouched and does
  not block Google sign-up.
- **Linking** needs a signed-in session. The callback must present both the binding cookie and the
  session that started the flow, so the signed-in session, not the state, decides the user. If the
  Google account already belongs to another user the link is rejected (`GOOGLE_LINK_CONFLICT`),
  and a user who has a different Google account linked cannot add another.
- **Limits**: starting sign-in and the callback are 20 per IP per 15 minutes each; starting a link
  is 5 per user per hour. All fail closed.
- **Auth events** added: `PASSWORD_RESET_REQUESTED/COMPLETED/FAILED`, `GOOGLE_LOGIN_STARTED/SUCCESS/FAILED`,
  `GOOGLE_LINK_STARTED/SUCCESS/FAILED/CONFLICT`. Events never hold passwords, tokens, codes or state.
  Request logs omit query strings because the callback URL carries the code and state.

**Google Cloud setup.** Create an OAuth client of type *Web application*. Set `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` together (all optional; empty disables Google). The
redirect URI must be registered exactly in Google Cloud Console and should be on the **web app's
origin**, e.g. `https://app.example.com/api/v1/auth/google/callback` (locally
`http://localhost:3000/api/v1/auth/google/callback`), so cookies set by the API are first-party. It
needs the same edge routing of `/api/*` as the rest of the API. Reset emails need working SMTP.

### Two-factor authentication (TOTP)

Authenticator-app codes only (RFC 6238: SHA-1, 6 digits, 30 s), implemented on `node:crypto` and tested
against the RFC's published vectors. No SMS and no email codes.

- **Setup** (`POST /auth/2fa/setup`, `/confirm`): needs a session. Setup makes a 160-bit secret and parks
  it in Redis for 10 minutes, encrypted and **keyed by the session** that started it. Nothing is enabled
  until a valid current code arrives. Confirming claims the pending setup atomically (`DEL`), so replays
  and simultaneous confirmations fail, and a different user or session cannot confirm. Missing, expired,
  wrong and replayed attempts all answer `TWO_FACTOR_CODE_INVALID`. The `otpauth://` URI (issuer and label
  from the brand config) goes to the browser, which draws the QR code locally (`qrcode-generator`); the
  secret is never sent to a third party. It is shown once and never returned again.
- **Secret at rest**: AES-256-GCM, fresh random 96-bit IV per value, the user id bound in as additional
  authenticated data (a ciphertext copied to another row will not decrypt). Stored as
  `v1.<iv>.<tag>.<ciphertext>` in `user_two_factor.encrypted_secret`; the `v1` prefix is the key version.
  The key is `TWO_FACTOR_ENCRYPTION_KEY` (below). One configuration per user and method
  (`UNIQUE(user_id, method)`); the row exists only while two-factor is on.
- **Verification**: accepts the current step and one either side (±30 s). Each accepted step is recorded
  (`last_used_step`) with a conditional update, so a code works once, anywhere. All steps are compared in
  constant time.
- **Recovery codes**: 10 per set, 80-bit random (`randomInt`, 32-symbol alphabet), shown as
  `xxxx-xxxx-xxxx-xxxx`. Only SHA-256 hashes are stored (`recovery_codes`, with a `generation` shared by
  the set). A code is used by an atomic conditional update, so two simultaneous uses cannot both succeed.
  They are shown exactly once (on enabling and on regeneration) and never retrievable. Regenerating
  replaces the whole set. Disabling deletes it. A password reset leaves two-factor and its codes alone.
- **Sign-in challenge**: after the first factor (password, email link or Google), an account with two-factor
  gets **no session**. It gets an `auth_challenges` row (5-minute lifetime, hash of a 256-bit token only)
  and the token in an HttpOnly `login-challenge` cookie (`__Host-` in production), so the challenge is bound
  to that browser and the page holds nothing. `POST /auth/2fa/verify` (code) or `/recovery` (recovery code)
  claims the challenge and checks the factor **in one transaction**, so a wrong code never uses up a
  recovery code or a time step, and a used challenge cannot be replayed. Five wrong codes kill the
  challenge; limits per IP (30/15 min) and per account (10/15 min) apply across challenges. Google sign-in
  honours the same challenge (redirect to `/login?step=two-factor`). `LoginSessionService` is the single
  place a sign-in becomes a session.
- **Reauthentication**: each session row has `authenticated_at`, set at sign-in and refreshed by
  `POST /auth/reauthenticate` (password) or the Google reauthentication flow (`POST /auth/google/reauth`,
  which asks Google to sign in again and only stamps the session if it is the linked account).
  "Recently authenticated" means within 10 minutes (`recentAuthSeconds`) and is decided from that column;
  nothing the client sends counts. `GET /auth/security` reports it.
- **Sensitive actions**: turning two-factor off and regenerating recovery codes need a recent
  authentication **and** a fresh authenticator code (a recovery code alone cannot do either). Changing the
  password needs the current password plus, with two-factor on, a code; it revokes the other sessions and
  any outstanding reset links and keeps the current session, which has just proved the old password.
  Google-only accounts have no password to change.
- **Sessions**: `GET /auth/sessions` lists live sessions (browser and OS summary, last active, IP; never a
  token or hash), flagging the current one. `POST /auth/sessions/:id/revoke` revokes one other session
  (own sessions only; anything else is `404`), `POST /auth/sessions/revoke-others` revokes all but the
  current one in a single statement. Rows are kept (`revoked_at`) for the audit trail.
- **Events** added: `TWO_FACTOR_SETUP_STARTED/ENABLED/FAILED/DISABLED`,
  `RECOVERY_CODES_GENERATED`, `RECOVERY_CODE_USED`, `RECOVERY_CODES_REGENERATED`, `SESSIONS_REVOKED`
  (plus the existing `SESSION_REVOKED`), `PASSWORD_CHANGED`, `REAUTHENTICATION_SUCCESS/FAILED`,
  `NEW_LOGIN`, `NEW_LOGIN_2FA_REQUIRED`. They never contain secrets, codes, tokens or hashes.
- **Security emails** (plain text, brand from config, via the SMTP abstraction, never blocking the
  action): password changed, two-factor on or off, recovery codes regenerated, and sign-in from a new
  device. A device is new when none of the user's earlier sessions had the same browser and OS; a user's
  first session, a repeat device or a known browser on a new network send nothing. Emails state what
  happened and what to do if it wasn't the user, and carry no codes or links with secrets.

**Production requirements.** Set `TWO_FACTOR_ENCRYPTION_KEY` to base64 of 32 random bytes
(`node -p "require('node:crypto').randomBytes(32).toString('base64')"`) in your secret manager. Production
**refuses to start** without it, there is no fallback and no generated key. Outside production, a missing
key just makes setup unavailable. Keep the key out of source control and logs.

**Key rotation is not automatic.** Changing the key makes every stored authenticator secret undecryptable;
those users then cannot finish signing in (the API answers `503` rather than guessing). To rotate safely,
add a second key and a decrypt-with-either path keyed on the `v<n>` prefix, re-encrypt all rows, then
retire the old key; until that exists, treat the key as permanent and back it up with the database.
Losing it is equivalent to losing everyone's second factor.

### Profile, mobile number, Telegram and notification preferences

All of these are routes under `@Authenticated()`; the account is always the session's user and no request
field can name another. Request bodies are strict zod schemas in `@repo/validation`, so unknown keys
(`userId`, `userNumber`, `email`, `email.security`, `push`) are rejected, not ignored. Responses are
`Cache-Control: no-store` and contain no internal IDs.

- **Profile** (`GET`/`PATCH /profile`): the public account number (10000+, immutable), display name, email
  (read-only here), avatar, masked mobile, Google and Telegram status, and time zone. The display name is
  trimmed, NFC-normalized, 1-50 characters, and refuses control, zero-width, bidi-override and `<`/`>`
  characters; it is not unique, not an identity, and rendered as plain text. `null` clears it. Avatars are
  generated initials: the project has no storage abstraction yet, so uploads (and their file-type and size
  validation) are deliberately not built. Time zone is a validated IANA name stored on `users`; language is
  not stored (there is no localization yet). Theme stays a client preference (Phase 1).
- **Mobile number** (`user_phones`, one optional row per user, E.164): `POST /profile/mobile/send-code`,
  `POST /profile/mobile/verify`, `DELETE /profile/mobile`. A number needs its country code (no country is
  assumed) and is stored on the user **only after** its code is confirmed; until then it lives in
  `phone_verification_challenges`, one row per user (`UNIQUE(user_id)`), so a new request replaces the old
  code and number and only the latest can succeed. Codes are 6 digits from `crypto.randomInt`, valid 10
  minutes, stored as a SHA-256 bound to user and number, and single-use (an atomic conditional `UPDATE`
  claims one, so simultaneous confirmations cannot both win). A challenge dies after 5 wrong codes. Missing,
  expired, used and wrong codes all answer `PHONE_CODE_INVALID`. Sending and removing need a recent
  authentication. The number is never returned in full (`+********3210`), logged, or put in an event
  (events carry the masked form). Numbers are deliberately **not unique** across users, so nothing can
  reveal that a number is used elsewhere.
- **SMS provider abstraction** (`SmsProvider`, token `SMS_PROVIDER`): `sendVerificationCode({ to, code,
  expiresInMinutes })`. No vendor is bundled or assumed. The default `UnavailableSmsProvider` sends nothing
  and reports `configured: false`, so the profile says mobile verification is unavailable. A real gateway
  adapter is registered for `SMS_PROVIDER` in `ProfileModule`; it must not log the code or the message (the
  service itself logs only the error type). Tests use a capturing provider.
- **SMS limits** (Redis, fail closed): one text per minute and 5 per hour per user; switching to a
  different number 3 per day; 5 per hour per destination number across all users (silent: it still answers
  "sent", so it can't reveal other accounts); 10 confirmation attempts per 15 minutes per user.
- **Telegram** (`telegram_connections`, `telegram_link_tokens`): a notification channel, never a sign-in
  method. `POST /profile/telegram/link` (recent authentication) returns
  `https://t.me/<bot>?start=<token>`; the token is 256-bit random, only its hash is stored, it is bound to the
  requesting user, valid 10 minutes, single-use, and a newer link replaces older ones.
  `POST /telegram/webhook` is called by Telegram. It has no cookie and no browser `Origin` (it alone is
  exempt from the origin check, via `@SkipOriginCheck()`) and is authenticated by the secret Telegram echoes
  in `X-Telegram-Bot-Api-Secret-Token`, compared in constant time; when Telegram isn't configured the route
  answers `404`. Only a private-chat `/start <token>` does anything; the token's row (not the message) says
  which user is linking, the claim is an atomic conditional update, and the identity is Telegram's numeric
  user id (`UNIQUE`), never the username. A Telegram account that already belongs to someone else is not
  moved or merged: the link is spent, `TELEGRAM_LINK_CONFLICT` is recorded, and the bot says so.
  `DELETE /profile/telegram` (recent authentication) disconnects. The bot token and webhook secret are
  server-only and redacted from logs.
- **Notification preferences** (`GET`/`PATCH /notifications/preferences`, table `notification_preferences`,
  created on first change; no row means the defaults in `defaultNotificationPreferences`): per channel and
  category (account, trading, promotions, plus security on Telegram). Defaults: account and trading on,
  promotions **off**, Telegram security on. **Security email is required**: it isn't stored, is reported as
  `security: true`, and sending `email.security` is a `400`. Telegram settings can only be changed while
  connected (`409 TELEGRAM_NOT_CONNECTED`), and a disconnected Telegram never counts as enabled. Push is
  reported unavailable. `NotificationPreferencesService.isAllowed(userId, channel, category)` is what future
  senders (trading, promotional and account emails) must call before sending. Existing security notices
  (password changed, 2FA, new sign-in) still always go by email.
- **Events** added: `PROFILE_UPDATED` (field names only), `PHONE_VERIFICATION_REQUESTED/FAILED`,
  `PHONE_VERIFIED`, `PHONE_CHANGED`, `PHONE_REMOVED`, `TELEGRAM_LINK_STARTED`, `TELEGRAM_LINKED`,
  `TELEGRAM_LINK_CONFLICT`, `TELEGRAM_UNLINKED`, `NOTIFICATION_PREFERENCES_UPDATED`.
- **Not production-verified**: the webhook has only been exercised against a fake Telegram, and SMS only
  against a fake provider. Before launch, add a real SMS adapter and register the webhook (below).

**Production configuration (all optional; the rest of the app runs without them).**

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot API token from @BotFather. Server-only; never sent to browsers. |
| `TELEGRAM_BOT_USERNAME` | Bot username (no `@`), used for the `t.me` deep link. |
| `TELEGRAM_WEBHOOK_SECRET` | 16-256 chars of `A-Za-z0-9_-`; Telegram sends it with every webhook call. |

Set all three or none. Register the webhook once per environment, with the same secret:

```
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<your-domain>/api/v1/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" -d 'allowed_updates=["message"]'
```

The `/api/*` edge routing must reach the API and must pass `X-Telegram-Bot-Api-Secret-Token` through. SMS has
no variables yet: configuring a gateway means adding an adapter and its server-only settings.

## Build pipeline

- Shared packages compile with `tsc` to `dist/`; Turborepo builds dependencies first (`^build`).
- Node-side code imports relative files with `.ts` extensions; `rewriteRelativeImportExtensions`
  rewrites them on emit, and the worker runs its sources directly in dev via Node type stripping.
- The API builds with the Nest CLI (decorator metadata requires `tsc`).
- Next.js apps use Turbopack and Tailwind CSS v4. Design tokens are shared from
  `@repo/ui/styles.css`. The system font stack avoids font downloads.
