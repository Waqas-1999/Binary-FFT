import { Global, Module } from "@nestjs/common";
import { loadServerConfig } from "@repo/config/server";

/** Injection token for the validated `ServerConfig`. */
export const SERVER_CONFIG = Symbol("SERVER_CONFIG");

@Global()
@Module({
  providers: [{ provide: SERVER_CONFIG, useFactory: () => loadServerConfig() }],
  exports: [SERVER_CONFIG],
})
export class ConfigModule {}
