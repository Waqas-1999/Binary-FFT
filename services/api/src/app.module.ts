import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.ts";
import { ConfigModule } from "./config/config.module.ts";
import { DatabaseModule } from "./database/database.module.ts";
import { HealthModule } from "./health/health.module.ts";
import { RateLimitModule } from "./rate-limit/rate-limit.module.ts";
import { RedisModule } from "./redis/redis.module.ts";

@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule, RateLimitModule, HealthModule, AuthModule],
})
export class AppModule {}
