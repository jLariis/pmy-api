import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ApprovalRequest, ApprovalType, CONSOLIDATED_ACTION_TYPES } from 'src/entities/approval-request.entity';
import { ConsolidatedChangeLog } from 'src/entities/consolidated-change-log.entity';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction, AuditModule, AuditResult, AuditSeverity } from 'src/common/enums/audit.enum';
import { ConsolidatedActionPayload, ConsolidatedActionsService, ConsolidatedImpact } from './consolidated-actions.service';
import { familyKey } from './consolidated-family.loader';
import { Subsidiary } from 'src/entities/subsidiary.entity';
import { User } from 'src/entities/user.entity';
import { Consolidated } from 'src/entities/consolidated.entity';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { ApprovalImpactService } from './impact.service';
import { NotificationsService } from 'src/notifications/notifications.service';

export type ApprovalActor = { userId: string; name?: string; role?: string };

const isSuperRole = (r?: string) => r === 'superadmin' || r === 'superamin';
const isConsolidatedAction = (t: ApprovalType) => CONSOLIDATED_ACTION_TYPES.includes(t);
const MIN_JUSTIFICATION = 10;

/**
 * Flujo de borrado con aprobación: solicitar → notificar al supervisor de la
 * sucursal → aprobar (ejecuta la baja lógica) o rechazar. La baja es solo
 * lógica (active=false); no revierte estatus ni cierres.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @InjectRepository(ApprovalRequest) private readonly repo: Repository<ApprovalRequest>,
    @InjectRepository(Subsidiary) private readonly subsidiaryRepo: Repository<Subsidiary>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Consolidated) private readonly consRepo: Repository<Consolidated>,
    @InjectRepository(PackageDispatch) private readonly dispatchRepo: Repository<PackageDispatch>,
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ChargeShipment) private readonly chargeRepo: Repository<ChargeShipment>,
    private readonly impact: ApprovalImpactService,
    private readonly notifier: NotificationsService,
    private readonly consolidatedActions: ConsolidatedActionsService,
    private readonly audit: AuditService,
    @InjectRepository(ConsolidatedChangeLog) private readonly changeLogRepo: Repository<ConsolidatedChangeLog>,
  ) {}

  /** Bitácora general (pantalla de Auditoría, módulo Consolidados). Nunca rompe la operación. */
  private auditLog(
    actor: ApprovalActor,
    r: Partial<ApprovalRequest>,
    action: AuditAction,
    description: string,
    extra: { result?: AuditResult; errorMessage?: string; afterState?: any } = {},
  ) {
    try {
      this.audit.log({
        userId: actor.userId,
        userName: actor.name,
        role: actor.role,
        module: AuditModule.CONSOLIDADOS,
        action,
        result: extra.result ?? AuditResult.SUCCESS,
        severity: extra.result === AuditResult.ERROR ? AuditSeverity.WARNING : AuditSeverity.INFO,
        entityName: 'Consolidado',
        entityId: r.targetId,
        subsidiaryId: r.subsidiaryId ?? undefined,
        description: description.slice(0, 500),
        beforeState: r.impactSnapshot ?? undefined,
        afterState: extra.afterState,
        errorMessage: extra.errorMessage,
        metadata: {
          approvalRequestId: r.id,
          type: r.type,
          justification: r.justification,
          payload: r.payload,
          requestedBy: r.requestedByName,
          approver: r.approverName,
        },
      });
    } catch {
      /* la bitácora general nunca bloquea */
    }
  }

  /** "Juan pidió cambiar de sucursal Consolidado 305… (Obregón → Cabo)". */
  private describe(r: Partial<ApprovalRequest>, verb: string): string {
    const imp = r.impactSnapshot as ConsolidatedImpact | undefined;
    const label = r.targetLabel ?? imp?.label ?? r.targetId;
    const action = r.type ? ConsolidatedActionsService.actionLabel(r.type) : 'modificar';
    const change = imp?.change ? ` (${imp.change.from} → ${imp.change.to})` : '';
    return `${verb} ${action} ${label}${change}`;
  }

  private userLabel(u: any): string {
    return [u?.name, u?.lastName].filter(Boolean).join(' ') || u?.email || u?.id;
  }

  /** Supervisor de la sucursal, con fallback al primer superadmin activo. */
  async resolveSupervisor(subsidiaryId?: string | null): Promise<{ id: string; name: string } | null> {
    if (subsidiaryId) {
      const s = await this.subsidiaryRepo.findOne({ where: { id: subsidiaryId } });
      if (s?.supervisorUserId) {
        const u = await this.userRepo.findOne({ where: { id: s.supervisorUserId } });
        if (u) return { id: u.id, name: this.userLabel(u) };
      }
    }
    const sup = await this.userRepo.findOne({ where: { role: In(['superadmin', 'superamin']) as any, active: true } as any });
    return sup ? { id: sup.id, name: this.userLabel(sup) } : null;
  }

  private async loadTargetActive(type: ApprovalType, targetId: string): Promise<{ active: boolean; subsidiaryId: string | null }> {
    if (type === 'delete_consolidado') {
      const c = await this.consRepo.findOne({ where: { id: targetId }, relations: ['subsidiary'] });
      if (!c) throw new NotFoundException('Consolidado no encontrado');
      return { active: (c as any).active !== false, subsidiaryId: (c as any).subsidiary?.id ?? null };
    }
    const d = await this.dispatchRepo.findOne({ where: { id: targetId }, relations: ['subsidiary'] });
    if (!d) throw new NotFoundException('Salida a ruta no encontrada');
    return { active: (d as any).active !== false, subsidiaryId: (d as any).subsidiary?.id ?? null };
  }

  async createRequest(input: {
    type: ApprovalType;
    targetId: string;
    actor: ApprovalActor;
    justification?: string;
    payload?: ConsolidatedActionPayload;
  }): Promise<ApprovalRequest> {
    if (isConsolidatedAction(input.type)) return this.createConsolidatedRequest(input);

    const { type, targetId, actor } = input;
    const target = await this.loadTargetActive(type, targetId);
    if (!target.active) throw new BadRequestException('El elemento ya fue dado de baja.');
    const existing = await this.repo.findOne({ where: { type, targetId, status: 'pendiente' } });
    if (existing) throw new BadRequestException('Ya existe una solicitud pendiente para este elemento.');

    const snapshot = await this.impact.build(type, targetId);
    const supervisor = await this.resolveSupervisor(target.subsidiaryId);
    const row = await this.repo.save(this.repo.create({
      type,
      targetId,
      subsidiaryId: target.subsidiaryId,
      requestedById: actor.userId,
      requestedByName: actor.name ?? null,
      approverId: supervisor?.id ?? null,
      approverName: supervisor?.name ?? null,
      status: 'pendiente',
      impactSnapshot: snapshot,
      justification: input.justification?.trim() || null,
      targetLabel: snapshot.label,
    }));

    await this.notifier.emit({
      type: 'aprobacion.solicitada',
      audience: supervisor ? { userId: supervisor.id } : { role: 'superadmin' },
      title: `Autorización requerida: eliminar ${snapshot.label}`,
      body: `${actor.name ?? 'Un usuario'} solicita eliminar ${snapshot.label} (${snapshot.counts.shipments} guías, ${snapshot.counts.charges} cargas).`,
      link: `/?approval=${row.id}`,
      entityId: row.id,
      subsidiaryId: target.subsidiaryId ?? undefined,
      actor: { id: actor.userId, name: actor.name },
      data: { impact: snapshot },
    });
    return row;
  }

  /** Borrar / cambiar sucursal / cambiar fecha de un consolidado (familia consNumber+sucursal). */
  private async createConsolidatedRequest(input: {
    type: ApprovalType;
    targetId: string;
    actor: ApprovalActor;
    justification?: string;
    payload?: ConsolidatedActionPayload;
  }): Promise<ApprovalRequest> {
    const { type, targetId, actor } = input;
    const justification = (input.justification ?? '').trim();
    if (justification.length < MIN_JUSTIFICATION) {
      throw new BadRequestException(`Escribe por qué (mínimo ${MIN_JUSTIFICATION} caracteres).`);
    }
    const payload: ConsolidatedActionPayload = {};
    if (type === 'change_subsidiary_consolidado') payload.newSubsidiaryId = input.payload?.newSubsidiaryId;
    if (type === 'change_date_consolidado') payload.newDate = input.payload?.newDate;

    // Valida y calcula el impacto (si no se puede, el mensaje sale de aquí).
    const impact = await this.consolidatedActions.impact(type, targetId, payload);
    const pending = await this.repo.findOne({ where: { targetKey: impact.targetKey, status: 'pendiente' } });
    if (pending) throw new BadRequestException('Ya hay una solicitud pendiente para este consolidado.');

    const supervisor = await this.resolveSupervisor(impact.approverSubsidiaryId);
    const row = await this.repo.save(this.repo.create({
      type,
      targetId,
      subsidiaryId: impact.subsidiaryId,
      requestedById: actor.userId,
      requestedByName: actor.name ?? null,
      approverId: supervisor?.id ?? null,
      approverName: supervisor?.name ?? null,
      status: 'pendiente',
      impactSnapshot: impact,
      justification,
      payload,
      targetKey: impact.targetKey,
      targetLabel: impact.label,
    }));

    const action = ConsolidatedActionsService.actionLabel(type);
    const change = impact.change ? ` (${impact.change.from} → ${impact.change.to})` : '';
    await this.notifier.emit({
      type: 'aprobacion.solicitada',
      audience: supervisor ? { userId: supervisor.id } : { role: 'superadmin' },
      title: `Autorización requerida: ${action} ${impact.label}${change}`,
      body: `${actor.name ?? 'Un usuario'} pide ${action} ${impact.label}${change}. Motivo: ${justification}`,
      link: `/?approval=${row.id}`,
      entityId: row.id,
      subsidiaryId: impact.approverSubsidiaryId,
      actor: { id: actor.userId, name: actor.name },
      data: { impact },
    });
    this.auditLog(actor, row, AuditAction.OTHER, this.describe(row, `${actor.name ?? 'Un usuario'} pidió`));
    return row;
  }

  private async loadForDecision(id: string, actor: ApprovalActor): Promise<ApprovalRequest> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    if (r.status !== 'pendiente') throw new BadRequestException('La solicitud ya fue resuelta.');
    const isSuper = isSuperRole(actor.role);
    if (!isSuper && !!r.requestedById && r.requestedById === actor.userId) {
      throw new ForbiddenException('No puedes autorizar tu propia solicitud.');
    }
    const allowed = isSuper || (!!r.approverId && r.approverId === actor.userId);
    if (!allowed) throw new ForbiddenException('No tienes permiso para autorizar esta solicitud.');
    return r;
  }

  private async executeLogicalDelete(r: ApprovalRequest): Promise<void> {
    if (r.type === 'delete_consolidado') {
      await this.consRepo.update(r.targetId, { active: false } as any);
      await this.shipmentRepo.update({ consolidatedId: r.targetId } as any, { active: false } as any);
      await this.chargeRepo.update({ consolidatedId: r.targetId } as any, { active: false } as any);
    } else {
      await this.dispatchRepo.update(r.targetId, { active: false } as any);
    }
  }

  async approve(id: string, actor: ApprovalActor): Promise<void> {
    const r = await this.loadForDecision(id, actor);
    if (isConsolidatedAction(r.type)) return this.approveConsolidated(r, actor);

    await this.executeLogicalDelete(r);
    await this.repo.update(id, {
      status: 'aprobado',
      approverId: actor.userId,
      approverName: actor.name ?? r.approverName,
      resolvedAt: new Date(),
    });
    const label = (r.impactSnapshot as any)?.label ?? r.targetId;
    await this.notifier.emit({
      type: 'aprobacion.aprobada',
      audience: r.requestedById ? { userId: r.requestedById } : { role: 'superadmin' },
      title: `Autorizado: eliminar ${label}`,
      body: `${actor.name ?? 'El encargado'} autorizó la eliminación de ${label}.`,
      entityId: r.id,
      actor: { id: actor.userId, name: actor.name },
    });
  }

  private async approveConsolidated(r: ApprovalRequest, actor: ApprovalActor): Promise<void> {
    let result: Awaited<ReturnType<ConsolidatedActionsService['execute']>>;
    try {
      result = await this.consolidatedActions.execute(r, actor);
    } catch (err: any) {
      // Nada se aplicó (transacción): la solicitud sigue pendiente con el motivo visible.
      const message = err?.response?.message ?? err?.message ?? 'Error desconocido';
      await this.repo.update(r.id, { executionError: String(message).slice(0, 2000) });
      this.auditLog(actor, r, AuditAction.OTHER, this.describe(r, 'No se pudo aplicar: autorizar'), {
        result: AuditResult.ERROR,
        errorMessage: String(message).slice(0, 1000),
      });
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException(`No se pudo aplicar el cambio: ${message}`);
    }

    await this.repo.update(r.id, {
      status: 'aprobado',
      approverId: actor.userId,
      approverName: actor.name ?? r.approverName,
      resolvedAt: new Date(),
      executedAt: new Date(),
      executionError: null,
      impactAfter: result.impactAfter as any,
      resultSummary: result.summary as any,
    });
    this.auditLog(
      actor,
      { ...r, approverName: actor.name ?? r.approverName },
      r.type === 'delete_consolidado' ? AuditAction.DELETE : AuditAction.UPDATE,
      this.describe(r, `${actor.name ?? 'El encargado'} autorizó`),
      { afterState: { impact: result.impactAfter, summary: result.summary } },
    );
    await this.notifier.emit({
      type: 'aprobacion.aprobada',
      audience: r.requestedById ? { userId: r.requestedById } : { role: 'superadmin' },
      title: this.describe(r, 'Autorizado:'),
      body: `${actor.name ?? 'El encargado'} autorizó y se aplicó el cambio.`,
      entityId: r.id,
      actor: { id: actor.userId, name: actor.name },
    });
  }

  async reject(id: string, actor: ApprovalActor, reason: string): Promise<void> {
    const r = await this.loadForDecision(id, actor);
    await this.repo.update(id, {
      status: 'rechazado',
      approverId: actor.userId,
      approverName: actor.name ?? r.approverName,
      reason: reason?.trim() || null,
      resolvedAt: new Date(),
    });
    const label = (r.impactSnapshot as any)?.label ?? r.targetId;
    if (isConsolidatedAction(r.type)) {
      this.auditLog(
        actor,
        { ...r, approverName: actor.name ?? r.approverName },
        AuditAction.OTHER,
        `${this.describe(r, `${actor.name ?? 'El encargado'} rechazó`)}. Motivo: ${reason?.trim() || '—'}`,
      );
    }
    await this.notifier.emit({
      type: 'aprobacion.rechazada',
      audience: r.requestedById ? { userId: r.requestedById } : { role: 'superadmin' },
      title: `Rechazado: eliminar ${label}`,
      body: reason?.trim() || `${actor.name ?? 'El encargado'} rechazó la solicitud.`,
      entityId: r.id,
      actor: { id: actor.userId, name: actor.name },
    });
  }

  async myPending(actor: ApprovalActor): Promise<ApprovalRequest[]> {
    const where: any = isSuperRole(actor.role)
      ? { status: 'pendiente' }
      : { status: 'pendiente', approverId: actor.userId };
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  /** Solicitudes de la familia (quién pidió, por qué, quién autorizó) + cada cambio aplicado. */
  async history(consNumber: string, subsidiaryId: string) {
    if (!consNumber || !subsidiaryId) throw new BadRequestException('Falta el consolidado o la sucursal.');
    const requests = await this.repo.find({
      where: { targetKey: familyKey(consNumber, subsidiaryId) },
      order: { createdAt: 'DESC' },
    });
    const ids = requests.map((r) => r.id);
    const changes = ids.length
      ? await this.changeLogRepo.find({ where: { approvalRequestId: In(ids) }, order: { createdAt: 'DESC' }, take: 5000 })
      : [];
    return { requests, changes };
  }

  async getImpact(type: ApprovalType, targetId: string, payload?: ConsolidatedActionPayload) {
    if (isConsolidatedAction(type)) {
      const impact = await this.consolidatedActions.impact(type, targetId, payload ?? {});
      const approver = await this.resolveSupervisor(impact.approverSubsidiaryId);
      return { ...impact, approver };
    }
    const snapshot = await this.impact.build(type, targetId);
    const supervisor = await this.resolveSupervisor(snapshot.subsidiaryId);
    return { ...snapshot, approver: supervisor };
  }
}
