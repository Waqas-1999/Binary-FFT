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
  const google = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI];
  if (google.some(Boolean) && !google.every(Boolean)) {
    context.addIssue({
      code: "custom",
      path: ["GOOGLE_CLIENT_ID"],
      message: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must be configured together",
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
