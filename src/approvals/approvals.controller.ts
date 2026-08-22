import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApprovalsService, ApprovalActor } from './approvals.service';
import { ApprovalType } from 'src/entities/approval-request.entity';

/**
 * Borrado con aprobación. La autenticación la aplica el JwtAuthGuard global.
 */
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly service: ApprovalsService) {}

  private actor(req: any): ApprovalActor {
    return { userId: req.user?.userId, name: req.user?.name, role: req.user?.role };
  }

  @Get('impact')
  impact(@Query('type') type: ApprovalType, @Query('targetId') targetId: string) {
    return this.service.getImpact(type, targetId);
  }

  @Post()
  create(@Body() body: { type: ApprovalType; targetId: string }, @Req() req: any) {
    return this.service.createRequest({ type: body.type, targetId: body.targetId, actor: this.actor(req) });
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
