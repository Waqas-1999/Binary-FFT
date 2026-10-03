import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import type { HealthResponse } from "@repo/types";
import type { Response } from "express";
import { HealthService } from "./health.service.ts";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const result = await this.health.check();
    if (result.status !== "ok") res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
