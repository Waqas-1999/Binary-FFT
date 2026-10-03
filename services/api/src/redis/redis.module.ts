import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service.ts";

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
