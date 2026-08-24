import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ApprovalRequest, ApprovalType } from 'src/entities/approval-request.entity';
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
  ) {}

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

  async createRequest(input: { type: ApprovalType; targetId: string; actor: ApprovalActor }): Promise<ApprovalRequest> {
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

  private async loadForDecision(id: string, actor: ApprovalActor): Promise<ApprovalRequest> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    if (r.status !== 'pendiente') throw new BadRequestException('La solicitud ya fue resuelta.');
    const allowed = isSuperRole(actor.role) || (!!r.approverId && r.approverId === actor.userId);
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

  async getImpact(type: ApprovalType, targetId: string) {
    const snapshot = await this.impact.build(type, targetId);
    const supervisor = await this.resolveSupervisor(snapshot.subsidiaryId);
    return { ...snapshot, approver: supervisor };
  }
}
