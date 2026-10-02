import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { LEGACY_ROLE_MAP } from 'src/auth/rbac/permission-catalog';
import { InboxQueryService, ListFilters, Scope } from './inbox-query.service';
import { InboxReviewService } from './inbox-review.service';
import { InboxIngestService } from './inbox-ingest.service';
import { InboxLinkService } from './inbox-link.service';
import { ZipCoverageService } from './zip-coverage.service';
import { AttachmentKind } from './inbox.types';
import { InboxPasteService } from './inbox-paste.service';
import { PasteBatchKind } from './paste-plan.util';

/**
 * Bandeja de correos (sistemas@; FedEx y, más adelante, DHL): lista, detalle, revisión, tablero
 * recibido vs subido y cobertura de CP. Usuarios no superadmin solo ven sus sucursales.
 */
@ApiTags('inbox')
@ApiBearerAuth()
@Controller('inbox')
@UseGuards(PermissionsGuard)
@RequirePermission('correo.bandeja')
export class InboxController {
  constructor(
    private readonly query: InboxQueryService,
    private readonly review: InboxReviewService,
    private readonly ingest: InboxIngestService,
    private readonly link: InboxLinkService,
    private readonly coverage: ZipCoverageService,
    private readonly paste: InboxPasteService,
  ) {}

  private isSuper(req: any): boolean {
    return LEGACY_ROLE_MAP[String(req?.user?.role ?? '').toLowerCase()] === 'superadmin';
  }

  private scope(req: any): Scope {
    if (this.isSuper(req)) return null;
    return (req?.user?.subsidiaryIds as string[] | undefined) ?? [];
  }

  private requireSuper(req: any): void {
    if (!this.isSuper(req)) throw new ForbiddenException('Solo el superadministrador puede hacer esto');
  }

  private async assertCanSee(req: any, messageId: string): Promise<void> {
    await this.query.detail(messageId, this.scope(req)); // lanza 404 si no lo puede ver
  }

  @Get('messages')
  @ApiOperation({ summary: 'Correos FedEx con filtros y contadores por vista' })
  list(@Query() q: ListFilters, @Req() req: any) {
    return this.query.list(q, this.scope(req));
  }

  @Get('messages/:id')
  detail(@Param('id') id: string, @Req() req: any) {
    return this.query.detail(id, this.scope(req));
  }

  @Post('messages/:id/confirm')
  @ApiOperation({ summary: 'Confirmar o corregir la sucursal (y el tipo de archivos); el sistema aprende' })
  async confirm(@Param('id') id: string, @Body() body: { subsidiaryId: string; attachmentKinds?: Record<string, AttachmentKind> }, @Req() req: any) {
    await this.assertCanSee(req, id);
    const scope = this.scope(req);
    if (scope !== null && !scope.includes(body?.subsidiaryId)) throw new ForbiddenException('No puedes asignar correos a esa sucursal');
    return this.review.confirm(id, body?.subsidiaryId, req?.user?.userId ?? null, body?.attachmentKinds);
  }

  @Post('messages/:id/ignore')
  async ignore(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: any) {
    await this.assertCanSee(req, id);
    return this.review.ignore(id, body?.reason);
  }

  @Get('messages/:id/paste-plan')
  @ApiOperation({ summary: 'Lotes del correo para abrir el "Pegar FedEx" ya lleno' })
  async pastePlan(@Param('id') id: string, @Req() req: any) {
    await this.assertCanSee(req, id);
    return this.paste.plan(id);
  }

  @Post('messages/:id/pasted')
  @ApiOperation({ summary: 'Registrar que un lote del correo se subió desde el pegado' })
  async pasted(@Param('id') id: string, @Body() body: { attachmentId: string; kind: PasteBatchKind; consNumber: string }, @Req() req: any) {
    await this.assertCanSee(req, id);
    await this.paste.markPasted(id, body, req?.user?.userId ?? null);
    return { ok: true };
  }

  @Get('attachments/:id/download')
  async download(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const msgId = await this.review.attachmentMessageId(id);
    if (!msgId) throw new NotFoundException('No se encontró el archivo');
    await this.assertCanSee(req, msgId);
    const f = await this.review.download(id);
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.filename)}"`);
    res.send(f.buffer);
  }

  @Post('redetect')
  @ApiOperation({ summary: 'Volver a evaluar correos no confirmados' })
  redetect(@Body() body: { ids?: string[] }, @Req() req: any) {
    this.requireSuper(req);
    return this.ingest.redetect(body?.ids);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Leer el buzón ahora' })
  async sync(@Req() req: any) {
    this.requireSuper(req);
    const r = await this.ingest.runSync(true);
    await this.link.linkPending();
    return r;
  }

  @Get('status')
  status() {
    return this.query.status();
  }

  @Put('status')
  async setStatus(@Body() body: { enabled: boolean }, @Req() req: any) {
    this.requireSuper(req);
    if (typeof body?.enabled !== 'boolean') throw new BadRequestException('Indica si se activa o se pausa');
    await this.ingest.setEnabled(body.enabled);
    return this.query.status();
  }

  @Get('board')
  @ApiOperation({ summary: 'Tablero recibido vs subido por sucursal y día' })
  board(@Query() q: { from?: string; to?: string; subsidiaryId?: string }, @Req() req: any) {
    return this.query.board(q, this.scope(req));
  }

  @Get('zip-coverage')
  zipCoverage(@Query('subsidiaryId') subsidiaryId?: string) {
    return this.coverage.list(subsidiaryId);
  }

  @Put('zip-coverage/:id')
  setZipStatus(@Param('id') id: string, @Body() body: { status: 'sugerido' | 'confirmado' | 'excluido' }, @Req() req: any) {
    this.requireSuper(req);
    return this.coverage.setStatus(id, body?.status);
  }

  @Post('zip-coverage')
  addZip(@Body() body: { zip: string; subsidiaryId: string; city?: string }, @Req() req: any) {
    this.requireSuper(req);
    return this.coverage.addManual(body ?? ({} as any));
  }

  @Post('zip-coverage/rebuild')
  rebuildZip(@Req() req: any) {
    this.requireSuper(req);
    return this.coverage.rebuildFromHistory();
  }
}
