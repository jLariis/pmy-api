import { Body, Controller, ForbiddenException, HttpCode, Logger, Param, Post } from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from 'src/auth/decorators/decorators/public-decorator';
import { NoAudit } from 'src/audit/audit.decorator';
import { WhereParcelDhlService } from './where-parcel-dhl.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { AuditLog } from 'src/entities/audit-log.entity';
import { AuditAction, AuditModule, AuditResult, AuditSeverity } from 'src/common/enums/audit.enum';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { classifyDhlException } from 'src/utils/dhl.utils';

/** Estatus crudos de WhereParcel que representan una incidencia/DEX de entrega. */
const EXCEPTION_RAW = new Set(['exception', 'failedattempt', 'deliveryfailure', 'attemptfail']);

/**
 * Receptor de webhooks de WhereParcel (push de cambios de estatus DHL).
 * Es PÚBLICO (WhereParcel llama sin JWT) pero se protege con un SECRETO en la
 * ruta: `/api/webhooks/whereparcel/:token`, donde token === WHEREPARCEL_WEBHOOK_SECRET.
 */
@ApiTags('webhooks')
@Controller('webhooks/whereparcel')
export class WhereParcelWebhookController {
  private readonly logger = new Logger(WhereParcelWebhookController.name);

  constructor(
    private readonly whereParcel: WhereParcelDhlService,
    private readonly shipments: ShipmentsService,
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
  ) {}

  @Public()
  @NoAudit()
  @ApiExcludeEndpoint()
  @Post(':token')
  @HttpCode(200)
  async receive(@Param('token') token: string, @Body() payload: any) {
    const secret = process.env.WHEREPARCEL_WEBHOOK_SECRET;
    if (!secret || token !== secret) {
      this.logger.warn('Webhook WhereParcel con token inválido (rechazado).');
      throw new ForbiddenException('Token inválido.');
    }

    try {
      // El payload puede venir como objeto único o como arreglo (batch).
      const items = Array.isArray(payload) ? payload : [payload];
      const results = items
        .map((p) => this.whereParcel.normalizeWebhook(p))
        .filter((r): r is NonNullable<typeof r> => !!r);

      if (results.length === 0) {
        return { ok: true, processed: 0 };
      }

      const persisted = await this.shipments.persistDhlTrackingResults(results);

      // Notificaciones (campana + push): solo cuando un estatus relevante cambió.
      await this.emitNotifications(persisted.updated);

      this.logger.log(`📨 Webhook WhereParcel: ${results.length} recibida(s), ${persisted.updated.length} actualizada(s).`);
      return { ok: true, processed: results.length, updated: persisted.updated.length };
    } catch (e: any) {
      // Respondemos 200 igual: si fue un error de datos nuestro, no queremos que
      // WhereParcel reintente en bucle. El error queda en logs.
      this.logger.error(`Error procesando webhook WhereParcel: ${e?.message}`);
      return { ok: false };
    }
  }

  /** Decide si una actualización amerita notificación y con qué texto/severidad. */
  private classify(u: { status: string; rawStatus?: string; detail?: string }): { label: string; severity: AuditSeverity } | null {
    const raw = (u.rawStatus || '').toLowerCase().replace(/[\s_-]/g, '');
    if (u.status === ShipmentStatusType.ENTREGADO) {
      return { label: 'Entregada', severity: AuditSeverity.INFO };
    }

    const isProblem = u.status === ShipmentStatusType.NO_ENTREGADO || EXCEPTION_RAW.has(raw);
    if (isProblem) {
      // Intenta clasificar el DEX exacto desde la descripción del evento.
      const dex = classifyDhlException(u.detail);
      const label = dex ? `DEX${dex.code} · ${dex.label}` : 'Incidencia / DEX de entrega';
      return { label, severity: AuditSeverity.WARNING };
    }
    return null;
  }

  /** Escribe un evento de auditoría por cada entrega / no-entrega / DEX → aparece en la campana. */
  private async emitNotifications(
    updated: { trackingNumber: string; status: string; subsidiaryId?: string; rawStatus?: string; detail?: string }[],
  ) {
    for (const u of updated) {
      const c = this.classify(u);
      if (!c) continue;
      // El motivo del evento (DEX/descripción) enriquece el mensaje cuando existe.
      const desc = u.detail ? `${c.label} — ${u.detail}` : c.label;
      try {
        await this.auditRepo.save(
          this.auditRepo.create({
            module: AuditModule.MONITOREO,
            action: AuditAction.STATUS_CHANGE,
            result: AuditResult.SUCCESS,
            severity: c.severity,
            method: 'POST',
            path: '/dhl-webhook',
            userName: 'WhereParcel (DHL)',
            description: `DHL ${u.trackingNumber}: ${desc}`.slice(0, 480),
            entityName: 'shipment',
            entityId: u.trackingNumber,
            subsidiaryId: u.subsidiaryId,
            createdAt: new Date(),
          }),
        );
      } catch (e: any) {
        this.logger.warn(`No se pudo emitir notificación DHL para ${u.trackingNumber}: ${e?.message}`);
      }
    }
  }
}
