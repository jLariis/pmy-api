import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApprovalsService, ApprovalActor } from './approvals.service';
import { ApprovalType } from 'src/entities/approval-request.entity';
import { ConsolidatedActionPayload } from './consolidated-actions.service';

/**
 * Solicitudes con autorización: borrar consolidado / salida a ruta, cambiar sucursal o fecha de
 * un consolidado. La autenticación la aplica el JwtAuthGuard global.
 */
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly service: ApprovalsService) {}

  private actor(req: any): ApprovalActor {
    return { userId: req.user?.userId, name: req.user?.name, role: req.user?.role };
  }

  @Get('impact')
  impact(
    @Query('type') type: ApprovalType,
    @Query('targetId') targetId: string,
    @Query('newSubsidiaryId') newSubsidiaryId?: string,
    @Query('newDate') newDate?: string,
  ) {
    return this.service.getImpact(type, targetId, { newSubsidiaryId, newDate });
  }

  @Post()
  create(
    @Body() body: { type: ApprovalType; targetId: string; justification?: string; payload?: ConsolidatedActionPayload },
    @Req() req: any,
  ) {
    return this.service.createRequest({
      type: body.type,
      targetId: body.targetId,
      actor: this.actor(req),
      justification: body.justification,
      payload: body.payload,
    });
  }

  /** Historial de un consolidado: solicitudes (quién, cuándo, por qué) y cada cambio aplicado. */
  @Get('history/consolidated')
  history(@Query('consNumber') consNumber: string, @Query('subsidiaryId') subsidiaryId: string) {
    return this.service.history(consNumber, subsidiaryId);
  }

  @Get('mine')
  mine(@Req() req: any) {
    return this.service.myPending(this.actor(req));
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Req() req: any) {
    return this.service.approve(id, this.actor(req));
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: any) {
    return this.service.reject(id, this.actor(req), body?.reason ?? '');
  }
}
