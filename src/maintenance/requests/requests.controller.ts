import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { MTTO } from '../maintenance.permissions';
import { RequestsService } from './requests.service';
import { QUOTE_ATTACHMENT_MAX_BYTES, QuotesService } from './quotes.service';
import { CreateRequestDto, QuoteDto, RejectRequestDto, UpdateRequestDto } from './dto/request.dto';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance/requests')
@UseGuards(PermissionsGuard)
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly quotes: QuotesService,
    private readonly orders: PurchaseOrdersService,
  ) {}

  /** Tablero: Compras/autorizador ven todas las sucursales (filtro opcional); los demás, una de sus sucursales. */
  @Get('board')
  board(@Query('subsidiaryId') subsidiaryId: string | undefined, @Query('type') type: string | undefined, @Req() req: any) {
    return this.requests.board({ subsidiaryId: subsidiaryId || undefined, type: type || undefined }, req.user);
  }

  /** Mis solicitudes: cualquier usuario autenticado. */
  @Get('mine')
  mine(@Query('type') type: string | undefined, @Req() req: any) {
    return this.requests.board({ mineUserId: req.user?.userId, type: type || undefined }, req.user);
  }

  /** Detalle: quien la levantó, Compras, el autorizador y admins de la sucursal (se valida en el servicio). */
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.requests.findOne(id, req.user);
  }

  /** Cualquier usuario autenticado levanta solicitudes para sus sucursales. */
  @Post()
  create(@Body() dto: CreateRequestDto, @Req() req: any) {
    return this.requests.create(dto, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRequestDto, @Req() req: any) {
    return this.requests.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.requests.remove(id, req.user);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Req() req: any) {
    return this.requests.cancel(id, req.user);
  }

  @Post(':id/approve')
  @RequirePermission(MTTO.revisar)
  approve(@Param('id') id: string, @Req() req: any) {
    return this.requests.approve(id, req.user);
  }

  @Post(':id/reject')
  @RequirePermission(MTTO.revisar)
  reject(@Param('id') id: string, @Body() dto: RejectRequestDto, @Req() req: any) {
    return this.requests.reject(id, dto.reason, req.user);
  }

  // ---------------- Cotizaciones ----------------

  @Post(':id/quotes')
  @RequirePermission(MTTO.revisar)
  createQuote(@Param('id') id: string, @Body() dto: QuoteDto, @Req() req: any) {
    return this.quotes.create(id, dto, req.user);
  }

  @Patch('quotes/:quoteId')
  @RequirePermission(MTTO.revisar)
  updateQuote(@Param('quoteId') quoteId: string, @Body() dto: QuoteDto, @Req() req: any) {
    return this.quotes.update(quoteId, dto, req.user);
  }

  @Delete('quotes/:quoteId')
  @RequirePermission(MTTO.revisar)
  removeQuote(@Param('quoteId') quoteId: string, @Req() req: any) {
    return this.quotes.remove(quoteId, req.user);
  }

  @Post('quotes/:quoteId/attachment')
  @RequirePermission(MTTO.revisar)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: QUOTE_ATTACHMENT_MAX_BYTES } }))
  uploadAttachment(@Param('quoteId') quoteId: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    return this.quotes.saveAttachment(quoteId, file, req.user);
  }

  @Get('quotes/:quoteId/attachment')
  @RequirePermission(MTTO.revisar, MTTO.solicitudes, MTTO.ordenes, MTTO.autorizar)
  async downloadAttachment(@Param('quoteId') quoteId: string, @Req() req: any, @Res() res: Response) {
    const { buffer, name, mime } = await this.quotes.readAttachment(quoteId, req.user);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    res.send(buffer);
  }

  @Post('quotes/:quoteId/convert')
  @RequirePermission(MTTO.revisar)
  async convert(@Param('quoteId') quoteId: string, @Query('submit') submit: string | undefined, @Req() req: any) {
    const po = await this.quotes.convert(quoteId, req.user);
    // "Elegir y mandar a autorizar": un solo clic crea la orden y la manda a autorización.
    return submit === 'true' ? this.orders.submit(po.id, req.user) : po;
  }
}
