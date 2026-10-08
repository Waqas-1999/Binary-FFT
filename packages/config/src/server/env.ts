import { toValidationIssues, z } from "@repo/validation";

const logLevels = ["fatal", "error", "warn", "log", "debug", "verbose"] as const;
const optionalTrimmedString = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(logLevels).default("log"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /**
   * Express "trust proxy": which proxies may set X-Forwarded-For. Off by default because a
   * client-controlled X-Forwarded-For would let callers pick their IP and dodge rate limits.
   * Enable only for a proxy that overwrites or appends it (e.g. the production edge proxy).
   */
  API_TRUST_PROXY: z
    .string()
    .default("false")
    .transform((value): boolean | number | string =>
      value === "false" ? false : value === "true" ? true : /^\d+$/.test(value) ? Number(value) : value,
    ),
  /** Public URL of the customer web app; used for links in emails and as an allowed origin. */
  WEB_APP_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  SMTP_HOST: optionalTrimmedString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  SMTP_USER: optionalTrimmedString,
  SMTP_PASSWORD: z.string().transform((value) => value || undefined).optional(),
  SMTP_FROM: optionalTrimmedString,
  /** Google OAuth client; all three must be set together. Leave empty to disable Google sign-in. */
  GOOGLE_CLIENT_ID: optionalTrimmedString,
  GOOGLE_CLIENT_SECRET: optionalTrimmedString,
  GOOGLE_REDIRECT_URI: z.url({ protocol: /^https?$/ }).or(z.literal("").transform(() => undefined)).optional(),
  /**
   * Base64 of 32 random bytes; encrypts TOTP secrets at rest (AES-256-GCM). Generate with
   * `node -p "require('node:crypto').randomBytes(32).toString('base64')"`. Required in production.
   * Changing it makes stored secrets undecryptable; see docs/01-architecture.md before rotating.
   */
  TWO_FACTOR_ENCRYPTION_KEY: z
    .string()
    .trim()
    .transform((value) => value || undefined)
    .optional(),
  /**
   * Telegram bot for notification delivery (not sign-in). All three must be set together; leave empty to
   * disable the integration. Optional in every environment: the rest of the app works without it.
   */
  TELEGRAM_BOT_TOKEN: optionalTrimmedString,
  TELEGRAM_BOT_USERNAME: optionalTrimmedString,
  TELEGRAM_WEBHOOK_SECRET: optionalTrimmedString,
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
}).superRefine((env, context) => {
  if (env.NODE_ENV === "production" && !env.SMTP_HOST) {
    context.addIssue({
      code: "custom",
      path: ["SMTP_HOST"],
      message: "SMTP_HOST is required in production",
    });
  }
  if (env.SMTP_HOST && !env.SMTP_FROM) {
    context.addIssue({
      code: "custom",
      path: ["SMTP_FROM"],
      message: "SMTP_FROM is required when SMTP_HOST is set",
    });
  }
  if (env.SMTP_FROM && !/^([^<>\r\n]+<[^\s<>@]+@[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+)$/.test(env.SMTP_FROM)) {
    context.addIssue({
      code: "custom",
      path: ["SMTP_FROM"],
      message: 'SMTP_FROM must be an address ("noreply@example.com") or "Name <noreply@example.com>"',
    });
  }
  if (env.TWO_FACTOR_ENCRYPTION_KEY) {
    const key = /^[A-Za-z0-9+/]+={0,2}$/.test(env.TWO_FACTOR_ENCRYPTION_KEY)
      ? Buffer.from(env.TWO_FACTOR_ENCRYPTION_KEY, "base64")
      : undefined;
    if (key?.length !== 32) {
      context.addIssue({
        code: "custom",
        path: ["TWO_FACTOR_ENCRYPTION_KEY"],
        message: "TWO_FACTOR_ENCRYPTION_KEY must be base64 of exactly 32 bytes",
      });
    }
  } else if (env.NODE_ENV === "production") {
    context.addIssue({
      code: "custom",
      path: ["TWO_FACTOR_ENCRYPTION_KEY"],
      message: "TWO_FACTOR_ENCRYPTION_KEY is required in production",
    });
  }
  const google = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI];
  if (google.some(Boolean) && !google.every(Boolean)) {
    context.addIssue({
      code: "custom",
      path: ["GOOGLE_CLIENT_ID"],
      message: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must be configured together",
    });
  }
  const telegram = [env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_BOT_USERNAME, env.TELEGRAM_WEBHOOK_SECRET];
  if (telegram.some(Boolean) && !telegram.every(Boolean)) {
    context.addIssue({
      code: "custom",
      path: ["TELEGRAM_BOT_TOKEN"],
      message: "TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET must be configured together",
    });
  }
  if (env.TELEGRAM_BOT_TOKEN && !/^\d{3,}:[\w-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN)) {
    context.addIssue({ code: "custom", path: ["TELEGRAM_BOT_TOKEN"], message: "TELEGRAM_BOT_TOKEN is not a valid bot token" });
  }
  if (env.TELEGRAM_BOT_USERNAME && !/^@?[A-Za-z][\w]{4,31}$/.test(env.TELEGRAM_BOT_USERNAME)) {
    context.addIssue({ code: "custom", path: ["TELEGRAM_BOT_USERNAME"], message: "TELEGRAM_BOT_USERNAME is not a valid bot username" });
  }
  if (env.TELEGRAM_WEBHOOK_SECRET && !/^[A-Za-z0-9_-]{16,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)) {
    context.addIssue({
      code: "custom",
      path: ["TELEGRAM_WEBHOOK_SECRET"],
      message: "TELEGRAM_WEBHOOK_SECRET must be 16-256 characters of A-Z, a-z, 0-9, _ or -",
    });
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
    context.addIssue({
      code: "custom",
      path: ["SMTP_PASSWORD"],
      message: "SMTP_USER and SMTP_PASSWORD must be configured together",
    });
  }
});

export type ServerEnv = z.infer<typeof envSchema>;
export type LogLevel = (typeof logLevels)[number];

/** Validates environment variables. Throws a readable error listing every invalid variable. */
export function parseServerEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = toValidationIssues(result.error)
      .map((issue) => `  ${issue.path}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
