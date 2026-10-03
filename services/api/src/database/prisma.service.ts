import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import type { ServerConfig } from "@repo/config/server";
import { SERVER_CONFIG } from "../config/config.module.ts";
import { PrismaClient } from "../generated/prisma/client.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(SERVER_CONFIG) config: ServerConfig) {
    // Connects lazily on the first query so the API can boot while the database is unavailable.
    super({ adapter: new PrismaPg({ connectionString: config.database.url }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
