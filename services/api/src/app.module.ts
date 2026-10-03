import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.ts";
import { DatabaseModule } from "./database/database.module.ts";
import { HealthModule } from "./health/health.module.ts";
import { RedisModule } from "./redis/redis.module.ts";

@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule, HealthModule],
})
export class AppModule {}
