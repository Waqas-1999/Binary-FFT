type Level = "info" | "warn" | "error";

/** Writes one JSON line per entry, matching the API's structured log format. */
function write(level: Level, message: string, params: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    context: "Worker",
    message,
    ...params,
  });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, params?: Record<string, unknown>) => write("info", message, params),
  warn: (message: string, params?: Record<string, unknown>) => write("warn", message, params),
  error: (message: string, params?: Record<string, unknown>) => write("error", message, params),
};
