import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFiles, UseGuards, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from 'src/auth/guards/super-admin.guard';
import { NoAudit } from 'src/audit/audit.decorator';
import { SupportService } from './support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { getSupportAgents } from './support-config';

const uploadRoot = path.join(process.cwd(), 'uploads', 'support');

@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
@UseGuards(JwtAuthGuard)
@NoAudit()
export class SupportController {
  constructor(private readonly service: SupportService) {}

  @Get('agents')
  agents() { return getSupportAgents().map(({ id, nombre, email }) => ({ id, nombre, email })); }

  /** Diagnóstico de canales de notificación (superadmin). */
  @Get('channels/health')
  @UseGuards(SuperAdminGuard)
  channelsHealth() { return this.service.channelHealth(); }

  /** Envía una notificación de prueba por los 3 canales al usuario actual (superadmin). */
  @Post('channels/test')
  @UseGuards(SuperAdminGuard)
  channelsTest(@Req() req: any) { return this.service.sendChannelTest(req.user.userId); }

  @Get('tickets')
  list(
    @Query('estado') estado?: string,
    @Query('tipo') tipo?: string,
    @Query('prioridad') prioridad?: string,
    @Query('q') q?: string,
    @Query('sucursal') sucursal?: string,
    @Query('asignado') asignado?: string,
  ) {
    return this.service.list({ estado, tipo, prioridad, q, sucursal, asignado }).then((tickets) => ({ tickets }));
  }

  @Get('tickets/mine')
  mine(@Req() req: any) {
    return this.service.listMine(req.user.userId).then((tickets) => ({ tickets }));
  }

  @Get('tickets/:id')
  getOne(@Param('id') id: string) { return this.service.getOne(id); }

  /**
   * Prompt de IA (superadmin) con archivos/componentes reales del grafo.
   * `?engine=ia` lo mejora con DeepSeek; default `deterministico` (sin costo de API).
   */
  @Get('tickets/:id/prompt')
  @UseGuards(SuperAdminGuard)
  aiPrompt(@Param('id') id: string, @Query('engine') engine?: string) {
    return this.service.buildAiPrompt(id, engine === 'ia' ? 'ia' : 'deterministico');
  }

  @Post('tickets')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('imagenes', 8, {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(uploadRoot, (req as any).__ticketDir ?? ((req as any).__ticketDir = randomUUID()));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) =>
      file.mimetype.startsWith('image/') ? cb(null, true) : cb(new BadRequestException('Solo imágenes'), false),
  }))
  create(@Body() dto: CreateTicketDto, @UploadedFiles() files: Express.Multer.File[], @Req() req: any) {
    const userAgent = (req.headers['user-agent'] || '').toString().slice(0, 300);
    return this.service.create({ ...dto, userAgent } as any, req.user, files);
  }

  @Patch('tickets/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto, @Req() req: any) {
    return this.service.update(id, dto, req.user);
  }

  /** Notifica el estatus actual del ticket a su creador (campana + WhatsApp). */
  @Post('tickets/:id/notify-status')
  notifyStatus(@Param('id') id: string) { return this.service.notifyStatusToRequester(id); }

  // ---- Aprobación (D) ----
  /** Aprueba el ticket. El servicio valida que el actor sea superadmin o autorizador de la zona. */
  @Post('tickets/:id/approve')
  approve(@Param('id') id: string, @Req() req: any) { return this.service.approveTicket(id, req.user); }

  /** Rechaza el ticket con un motivo. Mismo control de permiso que aprobar. */
  @Post('tickets/:id/reject')
  reject(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: any) {
    return this.service.rejectTicket(id, req.user, body?.note ?? '');
  }

  /** Zonas que el usuario actual puede autorizar (para el frontend). */
  @Get('approvals/mine')
  myApprovalZones(@Req() req: any) {
    return this.service.myApprovalZones(req.user.userId).then((zoneIds) => ({ zoneIds }));
  }

  /** Config de autorizadores por zona (superadmin). */
  @Get('authorizers')
  @UseGuards(SuperAdminGuard)
  authorizers(@Query('zoneId') zoneId?: string) { return this.service.listAuthorizers(zoneId); }

  @Post('authorizers')
  @UseGuards(SuperAdminGuard)
  addAuthorizer(@Body() body: { zoneId: string; userId: string }) {
    return this.service.addAuthorizer(body?.zoneId, body?.userId);
  }

  @Delete('authorizers/:id')
  @UseGuards(SuperAdminGuard)
  removeAuthorizer(@Param('id') id: string) { return this.service.removeAuthorizer(id); }

  @Post('tickets/:id/comments')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('imagenes', 6, {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(uploadRoot, 'comments', (req as any).__commentDir ?? ((req as any).__commentDir = randomUUID()));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) =>
      file.mimetype.startsWith('image/') ? cb(null, true) : cb(new BadRequestException('Solo imágenes'), false),
  }))
  addComment(@Param('id') id: string, @Body() dto: AddCommentDto, @UploadedFiles() files: Express.Multer.File[], @Req() req: any) {
    return this.service.addComment(id, dto, req.user, files);
  }
}
