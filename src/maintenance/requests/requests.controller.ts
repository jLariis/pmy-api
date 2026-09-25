import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { assertUploadedPdf } from '../dispatch/po-dispatch.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { MTTO } from '../maintenance.permissions';
import { RequestsService } from './requests.service';
import { QUOTE_ATTACHMENT_MAX_BYTES, QuotesService } from './quotes.service';
import { CreateRequestDto, QuoteDto, RejectRequestDto, UpdateRequestDto } from './dto/request.dto';
import { ComparisonService, SelectionDto } from './comparison.service';
import { RequestDispatchService, SendRfqDto } from '../dispatch/request-dispatch.service';
import { AddNeedDto, CaptureNeedPriceDto, NeedsService, PickOfferDto, SaveToCatalogDto } from './needs.service';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance/requests')
@UseGuards(PermissionsGuard)
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly quotes: QuotesService,
    private readonly comparison: ComparisonService,
    private readonly dispatch: RequestDispatchService,
    private readonly needs: NeedsService,
  ) {}

  /**
   * Tablero: Compras/autorizador ven todas las sucursales (filtro opcional); los administradores de sucursal
   * (permiso solicitudes) solo las suyas y en consulta — como en la v2 (`board/:subsidiaryId`).
   */
  @Get('board')
  @RequirePermission(MTTO.revisar, MTTO.solicitudes, MTTO.ordenes, MTTO.autorizar)
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

  /** "Generar orden con esta cotización": todo lo que cubre ese proveedor en una sola orden. */
  @Post('quotes/:quoteId/convert')
  @RequirePermission(MTTO.revisar)
  async convert(@Param('quoteId') quoteId: string, @Req() req: any) {
    const quote = await this.quotes.findQuote(quoteId);
    return this.comparison.generateOrders(quote.requestId, req.user, quoteId);
  }

  // ---------------- Comparativo por partida ----------------

  @Get(':id/comparison')
  comparisonOf(@Param('id') id: string, @Req() req: any) {
    return this.comparison.get(id, req.user);
  }

  @Put(':id/selection')
  @RequirePermission(MTTO.revisar)
  saveSelection(@Param('id') id: string, @Body() dto: SelectionDto, @Req() req: any) {
    return this.comparison.saveSelection(id, dto, req.user);
  }

  /** Una orden por proveedor ganador; todas van a autorización. */
  @Post(':id/generate-orders')
  @RequirePermission(MTTO.revisar)
  generateOrders(@Param('id') id: string, @Req() req: any) {
    return this.comparison.generateOrders(id, req.user);
  }

  /** PDF del comparativo (lo elegido o la propuesta). */
  @Get(':id/comparison-pdf')
  async comparisonPdf(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const { buffer, fileName } = await this.dispatch.comparisonPdf(id, req.user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(buffer);
  }

  // ---------------- Pedir cotización a proveedores ----------------

  /** PDF de la solicitud de cotización (opcionalmente dirigido a un proveedor). */
  @Get(':id/rfq-pdf')
  @RequirePermission(MTTO.revisar)
  async rfqPdf(@Param('id') id: string, @Query('supplierId') supplierId: string | undefined, @Req() req: any, @Res() res: Response) {
    const { buffer, fileName } = await this.dispatch.rfqPdf(id, req.user, supplierId || undefined);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(buffer);
  }

  /** Manda la solicitud de cotización a los proveedores elegidos; regresa el resultado por proveedor. */
  @Post(':id/rfq')
  @RequirePermission(MTTO.revisar)
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 10 * 1024 * 1024, files: 30 } }))
  async sendRfq(@Param('id') id: string, @Body() body: any, @UploadedFiles() files: Express.Multer.File[] | undefined, @Req() req: any) {
    // JSON normal, o multipart con `payload` (JSON) + un PDF por proveedor en el campo `pdf_<supplierId>`.
    const dto = await parseRfqBody(body);
    const pdfs: Record<string, Buffer> = {};
    for (const f of files ?? []) {
      assertUploadedPdf(f);
      if (f.fieldname.startsWith('pdf_')) pdfs[f.fieldname.slice(4)] = f.buffer;
    }
    return this.dispatch.sendRfq(id, dto, req.user, pdfs);
  }

  /** Bitácora de envíos de la solicitud de cotización. */
  @Get(':id/dispatches')
  @RequirePermission(MTTO.revisar, MTTO.autorizar)
  dispatches(@Param('id') id: string) {
    return this.dispatch.history(id);
  }

  // ---------------- Lo que se necesita (sugerencias) ----------------

  @Get(':id/needs')
  @RequirePermission(MTTO.revisar, MTTO.autorizar)
  listNeeds(@Param('id') id: string, @Req() req: any) {
    return this.needs.list(id, req.user);
  }

  @Post(':id/needs')
  @RequirePermission(MTTO.revisar)
  addNeed(@Param('id') id: string, @Body() dto: AddNeedDto, @Req() req: any) {
    return this.needs.add(id, dto, req.user);
  }

  @Post(':id/needs/recalculate')
  @RequirePermission(MTTO.revisar)
  recalculateNeeds(@Param('id') id: string, @Req() req: any) {
    return this.needs.recalculate(id, req.user);
  }

  @Delete('needs/:needId')
  @RequirePermission(MTTO.revisar)
  dismissNeed(@Param('needId') needId: string, @Req() req: any) {
    return this.needs.dismiss(needId, req.user);
  }

  /** Elegir una sugerencia: la pone en la cotización de ese proveedor (con precio del catálogo). */
  @Post('needs/:needId/pick')
  @RequirePermission(MTTO.revisar)
  pickOffer(@Param('needId') needId: string, @Body() dto: PickOfferDto, @Req() req: any) {
    return this.needs.pick(needId, dto, req.user);
  }

  /** Capturar a mano el precio que dio un proveedor para una pieza/insumo (sin catálogo). */
  @Post('needs/:needId/manual')
  @RequirePermission(MTTO.revisar)
  captureNeedPrice(@Param('needId') needId: string, @Body() dto: CaptureNeedPriceDto, @Req() req: any) {
    return this.needs.captureManual(needId, dto, req.user);
  }

  /** Conceptos cotizados que aún no están en el catálogo (para ofrecer guardarlos). */
  @Get(':id/uncataloged')
  @RequirePermission(MTTO.revisar)
  uncataloged(@Param('id') id: string, @Req() req: any) {
    return this.needs.uncataloged(id, req.user);
  }

  @Post(':id/save-to-catalog')
  @RequirePermission(MTTO.revisar)
  saveToCatalog(@Param('id') id: string, @Body() dto: SaveToCatalogDto, @Req() req: any) {
    return this.needs.saveToCatalog(id, dto, req.user);
  }
}

/** Cuerpo de "Pedir cotización": JSON, o multipart con el JSON en `payload`. Valida con los mensajes del DTO. */
export async function parseRfqBody(body: any): Promise<SendRfqDto> {
  let raw = body;
  if (typeof body?.payload === 'string') {
    try { raw = JSON.parse(body.payload); } catch { throw new BadRequestException('Datos de envío no válidos.'); }
  }
  const dto = plainToInstance(SendRfqDto, raw);
  const errors = await validate(dto);
  if (errors.length) {
    const msgs = errors.flatMap((e) => [...Object.values(e.constraints ?? {}), ...(e.children ?? []).flatMap((ch) => ch.children?.flatMap((g) => Object.values(g.constraints ?? {})) ?? [])]);
    throw new BadRequestException(msgs.length ? msgs : 'Datos de envío no válidos.');
  }
  return dto;
}
