import { Controller, Get, Query, Param, UseGuards, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { SuperAdminGuard } from './super-admin.guard';
import { TemplateService } from 'src/documents/template.service';

/** Helper puro: formatea `createdAt` a es-MX (como el armado legacy) y conserva el resto de campos. */
export function buildAuditExcelRows(rows: any[]): any[] {
  return (rows ?? []).map((r) => ({
    ...r,
    createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString('es-MX') : '',
  }));
}

/** Todo el módulo de auditoría es EXCLUSIVO de superadmin (incluye variante legacy 'superamin'). */
@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly templates: TemplateService,
  ) {}

  @Get()
  findAll(@Query() q: QueryAuditLogDto) {
    return this.audit.findAll(q);
  }

  @Get('dashboard')
  dashboard(@Query('dateFrom') from: string, @Query('dateTo') to: string) {
    return this.audit.dashboard(this.parseFrom(from), this.parseTo(to));
  }

  @Get('suspicious')
  suspicious(@Query('dateFrom') from: string, @Query('dateTo') to: string) {
    return this.audit.detectSuspicious(this.parseFrom(from), this.parseTo(to));
  }

  /** Usuarios con sesión activa (derivado de actividad reciente). */
  @Get('active-users')
  activeUsers(@Query('windowMinutes') windowMinutes?: string) {
    return this.audit.getActiveUsers(Number(windowMinutes) || 15);
  }

  @Get('module/:module')
  byModule(@Param('module') m: string, @Query('limit') limit?: string) {
    return this.audit.findByModule(m, Number(limit) || 20);
  }

  /** Inactividad por sucursal: desde cuándo no se hace cada operación clave. */
  @Get('subsidiaries-activity')
  subsidiariesActivity() {
    return this.audit.getSubsidiariesActivity();
  }

  /** Detalle de una sucursal: últimos registros por operación (quién, cuándo, folio). */
  @Get('subsidiaries/:id/recent')
  subsidiaryRecent(@Param('id') id: string, @Query('perOp') perOp?: string) {
    return this.audit.getSubsidiaryRecent(id, Number(perOp) || 6);
  }

  /** Lista de usuarios + estadísticas de auditoría y estado en línea. */
  @Get('users')
  users() {
    return this.audit.getUsers();
  }

  /** Detalle completo de un usuario (acciones, dispositivos, ubicaciones, sesiones, eventos). */
  @Get('users/:userId')
  userDetail(
    @Param('userId') id: string,
    @Query('dateFrom') from?: string,
    @Query('dateTo') to?: string,
  ) {
    return this.audit.getUserDetail(id, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  @Get('user/:userId')
  byUser(@Param('userId') id: string, @Query('limit') limit?: string) {
    return this.audit.findByUser(id, Number(limit) || 20);
  }

  @Get('export/excel')
  async exportExcel(@Query() q: QueryAuditLogDto, @Res() res: Response) {
    const raw = await this.audit.findForExport(q);
    const rows = buildAuditExcelRows(raw);
    try {
      const r = await this.templates.render('audit_log_excel', { rows });
      if (r.buffer) {
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader('Content-Disposition', 'attachment; filename="auditoria.xlsx"');
        res.end(r.buffer);
        return;
      }
    } catch {
      /* cae a legacy */
    }
    // ----- LEGACY (armado inline con ExcelJS) como fallback -----
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Auditoría');
    ws.columns = [
      { header: 'Fecha', key: 'createdAt', width: 22 },
      { header: 'Usuario', key: 'userEmail', width: 28 },
      { header: 'Nombre', key: 'userName', width: 24 },
      { header: 'Rol', key: 'role', width: 12 },
      { header: 'Módulo', key: 'module', width: 18 },
      { header: 'Sucursal', key: 'subsidiaryName', width: 22 },
      { header: 'Acción', key: 'action', width: 14 },
      { header: 'Registro', key: 'entityId', width: 26 },
      { header: 'Resultado', key: 'result', width: 12 },
      { header: 'IP', key: 'ip', width: 16 },
      { header: 'Descripción', key: 'description', width: 50 },
    ];
    ws.getRow(1).font = { bold: true };
    raw.forEach((r) =>
      ws.addRow({
        ...r,
        createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString('es-MX') : '',
      }),
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="auditoria.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  }

  private parseFrom(from?: string): Date {
    return from ? new Date(from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }
  private parseTo(to?: string): Date {
    return to ? new Date(to) : new Date();
  }
}
