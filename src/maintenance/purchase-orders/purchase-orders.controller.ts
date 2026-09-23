import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { SubsidiaryScopeGuard } from 'src/auth/guards/subsidiary-scope.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { MTTO } from '../maintenance.permissions';
import { assertSubsidiaryScope } from '../maintenance-scope.util';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PoDispatchService } from '../dispatch/po-dispatch.service';
import { HistoryService } from '../schedule/history.service';
import { AuthorizeDto, CancelDto, CompleteDto, ReasonDto, SendDto, UpdatePurchaseOrderDto } from './dto/purchase-order.dto';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
@UseGuards(PermissionsGuard)
export class PurchaseOrdersController {
  constructor(
    private readonly orders: PurchaseOrdersService,
    private readonly dispatch: PoDispatchService,
    private readonly history: HistoryService,
  ) {}

  @Get('purchase-orders/subsidiary/:subsidiaryId')
  @RequirePermission(MTTO.ordenes, MTTO.autorizar)
  list(@Param('subsidiaryId') subsidiaryId: string, @Query('status') status: string | undefined, @Req() req: any) {
    // Scope manual: el autorizador ve todas las sucursales (SubsidiaryScopeGuard lo bloquearía).
    assertSubsidiaryScope(req.user, subsidiaryId);
    return this.orders.listBySubsidiary(subsidiaryId, status);
  }

  @Get('purchase-orders/pending')
  @RequirePermission(MTTO.autorizar)
  pending() {
    return this.orders.pending();
  }

  @Get('purchase-orders/:id')
  @RequirePermission(MTTO.ordenes, MTTO.autorizar, MTTO.solicitudes)
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.orders.findOne(id, req.user);
  }

  @Patch('purchase-orders/:id')
  @RequirePermission(MTTO.ordenes, MTTO.autorizar)
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto, @Req() req: any) {
    return this.orders.update(id, dto, req.user);
  }

  @Post('purchase-orders/:id/submit')
  @RequirePermission(MTTO.ordenes)
  submit(@Param('id') id: string, @Req() req: any) {
    return this.orders.submit(id, req.user);
  }

  @Post('purchase-orders/:id/authorize')
  @RequirePermission(MTTO.autorizar)
  authorize(@Param('id') id: string, @Body() dto: AuthorizeDto, @Req() req: any) {
    return this.orders.authorize(id, dto, req.user);
  }

  @Post('purchase-orders/:id/reject')
  @RequirePermission(MTTO.autorizar)
  reject(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return this.orders.reject(id, dto.reason, req.user);
  }

  @Post('purchase-orders/:id/cancel')
  @RequirePermission(MTTO.ordenes, MTTO.autorizar)
  async cancel(@Param('id') id: string, @Body() dto: CancelDto, @Req() req: any) {
    const { previousStatus, order } = await this.orders.cancel(id, dto.reason, req.user);
    if (previousStatus === 'enviada' && dto.notifySupplier) await this.dispatch.sendCancellation(order, dto.reason, req.user);
    return this.orders.findOne(id, req.user);
  }

  @Delete('purchase-orders/:id')
  @RequirePermission(MTTO.ordenes)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.orders.remove(id, req.user);
  }

  @Get('purchase-orders/:id/pdf')
  @RequirePermission(MTTO.ordenes, MTTO.autorizar, MTTO.solicitudes)
  async pdf(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const po = await this.orders.findOne(id, req.user);
    const { buffer, fileName } = await this.dispatch.renderPdf(po);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(buffer);
  }

  @Post('purchase-orders/:id/send')
  @RequirePermission(MTTO.ordenes, MTTO.autorizar)
  async send(@Param('id') id: string, @Body() dto: SendDto, @Req() req: any) {
    const po = await this.orders.findOne(id, req.user);
    await this.dispatch.send(po, req.user, dto);
    return this.orders.findOne(id, req.user);
  }

  @Get('purchase-orders/:id/dispatches')
  @RequirePermission(MTTO.ordenes, MTTO.autorizar)
  async dispatches(@Param('id') id: string, @Req() req: any) {
    await this.orders.findOne(id, req.user);
    return this.dispatch.history(id);
  }

  @Post('purchase-orders/:id/complete')
  @RequirePermission(MTTO.ordenes)
  complete(@Param('id') id: string, @Body() dto: CompleteDto, @Req() req: any) {
    return this.orders.complete(id, dto, req.user);
  }

  @Get('history/subsidiary/:subsidiaryId')
  @UseGuards(SubsidiaryScopeGuard)
  @RequirePermission(MTTO.historial)
  historyBySubsidiary(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    return this.history.bySubsidiary(subsidiaryId, { from, to, vehicleId });
  }
}
