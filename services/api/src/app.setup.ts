import { VersioningType } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { ServerConfig } from "@repo/config/server";
import { AllExceptionsFilter } from "./common/all-exceptions.filter.ts";
import { OriginGuard } from "./common/origin.guard.ts";
import { requestLogger } from "./common/request-logger.middleware.ts";

/** HTTP pipeline shared by the server entry point and integration tests. */
export function configureApp(app: NestExpressApplication, config: ServerConfig): void {
  // Client IPs (rate limits, audit events) come from X-Forwarded-For only for trusted proxies.
  app.set("trust proxy", config.app.trustProxy);
  app.disable("x-powered-by");
  app.enableCors({ origin: config.app.corsOrigins, credentials: true });
  app.use(requestLogger());
  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalGuards(new OriginGuard(config.app.allowedOrigins));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
