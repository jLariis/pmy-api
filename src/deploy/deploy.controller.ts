import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from '../audit/super-admin.guard';
import { NoAudit } from '../audit/audit.decorator';
import { DeployService } from './deploy.service';
import { DeployAnalysisService } from './deploy-analysis.service';
import { StartDeployDto } from './dto/start-deploy.dto';

/** Configuración → Servidor → Actualizar (solo superadmin). */
@ApiTags('server')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('server/deploy')
export class DeployController {
  constructor(
    private readonly deploy: DeployService,
    private readonly analysis: DeployAnalysisService,
  ) {}

  @Get('status')
  @NoAudit()
  status() {
    return this.deploy.status();
  }

  /** Qué trae main: commits, notas, migraciones y versión sugerida. No toca nada. */
  @Post('preview')
  @NoAudit()
  preview() {
    return this.analysis.preview();
  }

  @Post('run')
  run(@Body() dto: StartDeployDto, @Req() req: any) {
    return this.deploy.start(dto.bump, dto.notes, req.user?.userId ?? req.user?.id ?? null);
  }

  @Get('runs')
  @NoAudit()
  runs() {
    return this.deploy.listRuns();
  }

  @Get('runs/:id/log')
  @NoAudit()
  log(@Param('id', ParseUUIDPipe) id: string, @Query('offset') offset?: string) {
    return this.deploy.readLog(id, Number(offset) || 0);
  }
}
