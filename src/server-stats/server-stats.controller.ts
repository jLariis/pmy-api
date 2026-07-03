import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ServerStatsService } from './server-stats.service';
import { ServerLogsService, ServerLogKind } from './server-logs.service';
import { SuperAdminGuard } from '../audit/super-admin.guard';
import { NoAudit } from 'src/audit/audit.decorator';

@ApiTags('server')
@ApiBearerAuth()
@Controller('server')
@UseGuards(SuperAdminGuard)
export class ServerStatsController {
  constructor(
    private readonly serverStatsService: ServerStatsService,
    private readonly serverLogsService: ServerLogsService,
  ) {}

  /** Métricas de uso del servidor (CPU, memoria, disco, red) — solo superadmin. */
  @Get('stats')
  stats() {
    return this.serverStatsService.snapshot();
  }

  /**
   * Tail de los logs de Winston (NDJSON) — solo superadmin. `level=error`
   * limita al archivo de errores del día. `date=YYYY-MM-DD` elige qué día leer
   * (default hoy); si es hoy, la conexión se queda abierta en vivo, si es una
   * fecha pasada se manda una carga histórica y se cierra.
   */
  @Get('logs/stream')
  @NoAudit()
  streamLogs(@Query('level') level: string, @Query('date') dateStr: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    const kind: ServerLogKind = level === 'error' ? 'error' : 'combined';
    this.serverLogsService.streamTo(res, kind, this.parseDate(dateStr));
  }

  /** Parsea `YYYY-MM-DD`; cualquier valor inválido o futuro cae a "hoy". */
  private parseDate(dateStr?: string): Date {
    const now = new Date();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
    if (!m) return now;
    const parsed = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (isNaN(parsed.getTime()) || parsed > now) return now;
    return parsed;
  }
}
