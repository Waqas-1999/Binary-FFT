import { toValidationIssues, z } from "@repo/validation";

const logLevels = ["fatal", "error", "warn", "log", "debug", "verbose"] as const;

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
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
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
