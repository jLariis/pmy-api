import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ServerStatsService } from './server-stats.service';
import { SuperAdminGuard } from '../audit/super-admin.guard';

@ApiTags('server')
@ApiBearerAuth()
@Controller('server')
@UseGuards(SuperAdminGuard)
export class ServerStatsController {
  constructor(private readonly serverStatsService: ServerStatsService) {}

  /** Métricas de uso del servidor (CPU, memoria, disco, red) — solo superadmin. */
  @Get('stats')
  stats() {
    return this.serverStatsService.snapshot();
  }
}
