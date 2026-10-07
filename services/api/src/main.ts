import { ConsoleLogger, Logger, type LogLevel } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { ServerConfig } from "@repo/config/server";
import { AppModule } from "./app.module.ts";
import { configureApp } from "./app.setup.ts";
import { SERVER_CONFIG } from "./config/config.module.ts";

// Ordered from most to least severe; a configured level enables itself and everything above it.
const LOG_LEVELS: LogLevel[] = ["fatal", "error", "warn", "log", "debug", "verbose"];

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get<ServerConfig>(SERVER_CONFIG);

  app.useLogger(
    new ConsoleLogger({
      json: true,
      colors: !config.app.isProduction,
      logLevels: LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(config.app.logLevel) + 1),
      flattenParams: true,
      // Defence in depth: never print credentials even if a future log call passes them.
      redact: ["password", "passwordHash", "token", "tokenHash", "cookie", "authorization"],
    }),
  );
  configureApp(app, config);

  await app.listen(config.app.apiPort);
  Logger.log(`API listening on port ${config.app.apiPort}`, "Bootstrap");
}

void bootstrap();
