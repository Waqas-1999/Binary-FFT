import { ConsoleLogger, Logger, type LogLevel, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { ServerConfig } from "@repo/config/server";
import { AppModule } from "./app.module.ts";
import { AllExceptionsFilter } from "./common/all-exceptions.filter.ts";
import { requestLogger } from "./common/request-logger.middleware.ts";
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
    }),
  );
  app.disable("x-powered-by");
  app.enableCors({ origin: config.app.corsOrigins });
  app.use(requestLogger());
  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.listen(config.app.apiPort);
  Logger.log(`API listening on port ${config.app.apiPort}`, "Bootstrap");
}

void bootstrap();
