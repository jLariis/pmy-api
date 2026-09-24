import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { SubsidiaryScopeGuard } from 'src/auth/guards/subsidiary-scope.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { MTTO } from '../maintenance.permissions';
import { RequestsService } from './requests.service';
import { QUOTE_ATTACHMENT_MAX_BYTES, QuotesService } from './quotes.service';
import { CreateRequestDto, QuoteDto, UpdateRequestDto } from './dto/request.dto';
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

  @Get('board/:subsidiaryId')
  @UseGuards(SubsidiaryScopeGuard)
  @RequirePermission(MTTO.solicitudes, MTTO.ordenes, MTTO.autorizar)
  board(@Param('subsidiaryId') subsidiaryId: string) {
    return this.requests.board(subsidiaryId);
  }

  @Get('subsidiary/:subsidiaryId')
  @UseGuards(SubsidiaryScopeGuard)
  @RequirePermission(MTTO.solicitudes, MTTO.ordenes)
  list(@Param('subsidiaryId') subsidiaryId: string, @Query('status') status?: string) {
    return this.requests.listBySubsidiary(subsidiaryId, status);
  }

  @Get('inbox/:subsidiaryId')
  @UseGuards(SubsidiaryScopeGuard)
  @RequirePermission(MTTO.solicitudes)
  inbox(@Param('subsidiaryId') subsidiaryId: string) {
    return this.requests.inbox(subsidiaryId);
  }

  @Get(':id')
  @RequirePermission(MTTO.solicitudes, MTTO.ordenes, MTTO.autorizar)
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.requests.findOne(id, req.user);
  }

  @Post()
  @RequirePermission(MTTO.solicitudes)
  create(@Body() dto: CreateRequestDto, @Req() req: any) {
    return this.requests.create(dto, req.user);
  }

  @Patch(':id')
  @RequirePermission(MTTO.solicitudes)
  update(@Param('id') id: string, @Body() dto: UpdateRequestDto, @Req() req: any) {
    return this.requests.update(id, dto, req.user);
  }

  @Delete(':id')
  @RequirePermission(MTTO.solicitudes)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.requests.remove(id, req.user);
  }

  @Post(':id/cancel')
  @RequirePermission(MTTO.solicitudes)
  cancel(@Param('id') id: string, @Req() req: any) {
    return this.requests.cancel(id, req.user);
  }

  // ---------------- Cotizaciones ----------------

  @Post(':id/quotes')
  @RequirePermission(MTTO.solicitudes)
  createQuote(@Param('id') id: string, @Body() dto: QuoteDto, @Req() req: any) {
    return this.quotes.create(id, dto, req.user);
  }

  @Patch('quotes/:quoteId')
  @RequirePermission(MTTO.solicitudes)
  updateQuote(@Param('quoteId') quoteId: string, @Body() dto: QuoteDto, @Req() req: any) {
    return this.quotes.update(quoteId, dto, req.user);
  }

  @Delete('quotes/:quoteId')
  @RequirePermission(MTTO.solicitudes)
  removeQuote(@Param('quoteId') quoteId: string, @Req() req: any) {
    return this.quotes.remove(quoteId, req.user);
  }

  @Post('quotes/:quoteId/attachment')
  @RequirePermission(MTTO.solicitudes)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: QUOTE_ATTACHMENT_MAX_BYTES } }))
  uploadAttachment(@Param('quoteId') quoteId: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    return this.quotes.saveAttachment(quoteId, file, req.user);
  }

  @Get('quotes/:quoteId/attachment')
  @RequirePermission(MTTO.solicitudes, MTTO.ordenes, MTTO.autorizar)
  async downloadAttachment(@Param('quoteId') quoteId: string, @Req() req: any, @Res() res: Response) {
    const { buffer, name, mime } = await this.quotes.readAttachment(quoteId, req.user);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    res.send(buffer);
  }

  @Post('quotes/:quoteId/convert')
  @RequirePermission(MTTO.solicitudes)
  async convert(@Param('quoteId') quoteId: string, @Query('submit') submit: string | undefined, @Req() req: any) {
    const po = await this.quotes.convert(quoteId, req.user);
    // "Elegir y mandar a autorizar": un solo clic crea la orden y la manda a autorización.
    return submit === 'true' ? this.orders.submit(po.id, req.user) : po;
  }
}
