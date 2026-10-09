import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { OpsAlertSubsidiary } from '../entities/ops-alert.entity';
import { LifecycleService } from './lifecycle.service';
import { OpsAlertsService } from './ops-alerts.service';
import { SendLogService, SendResult } from './send-log.service';
import { analyzeConsolidated, buildNoticeMessage, Finding, FindingCode, isWrongType } from './consolidated-analysis.util';

const KIND_LABEL: Record<string, string> = { master: 'Master', f2: 'F2 (carga)', aereo: 'Aéreo', high_value: 'Alto valor', cod: 'COD', dhl: 'DHL' };

export interface NoticeRequest {
  findings: FindingCode[];
  note?: string | null;
  withSamples?: boolean;
  targets: { groups?: boolean; subsidiary?: boolean; managers?: boolean; numbers?: boolean };
}

/**
 * "Mandar aviso" a mano: el sistema analiza el consolidado guía por guía, la persona elige qué
 * hallazgos y a quién (grupos generales, usuarios de la sucursal, encargados, números), y todo
 * queda en el historial de Correos.
 */
@Injectable()
export class NoticeService {
  constructor(
    @InjectRepository(InboxConsolidation) private readonly consRepo: Repository<InboxConsolidation>,
    @InjectRepository(OpsAlertSubsidiary) private readonly subRepo: Repository<OpsAlertSubsidiary>,
    private readonly lifecycle: LifecycleService,
    private readonly alerts: OpsAlertsService,
    private readonly sendLog: SendLogService,
    private readonly ds: DataSource,
  ) {}

  private async load(id: string, scope: string[] | null) {
    const c = await this.consRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('No se encontró ese consolidado');
    if (scope !== null && (!c.subsidiaryId || !scope.includes(c.subsidiaryId))) throw new ForbiddenException('Ese consolidado es de otra sucursal');
    return c;
  }

  async analyze(id: string, scope: string[] | null) {
    const c = await this.load(id, scope);
    // Subida con el tipo equivocado: sus guías están dentro de OTRO consolidado (se siguen ahí); el
    // único punto es el tipo. Si no, el análisis normal guía por guía.
    const wrong = isWrongType(c);
    const guides = wrong ? [] : await this.lifecycle.guideFacts((c.uploadedAsKind ?? (c.kind === 'f2' ? 'f2' : 'master')) as 'f2' | 'master', c.uploadedAs || c.consNumber);
    const findings: Finding[] = wrong
      ? [{
          code: 'tipo_equivocado',
          severity: 'alta',
          text: c.kind === 'f2'
            ? `Las guías de esta F2 se subieron como paquete en el master ${c.uploadedAs}. Hay que pasarlas a carga (Consolidados → Cambiar tipo).`
            : `Este master se subió como carga en ${c.uploadedAs}. Hay que cambiarlo a paquete (Consolidados → Cambiar tipo).`,
          count: c.announcedCount ?? 0,
          samples: [],
        }]
      : analyzeConsolidated({ receivedAt: c.receivedAt, announcedCount: c.announcedCount, guides, now: new Date() });
    const [sub]: any[] = c.subsidiaryId ? await this.ds.query('SELECT name FROM subsidiary WHERE id = ?', [c.subsidiaryId]) : [];
    const cfg = c.subsidiaryId ? await this.subRepo.findOne({ where: { subsidiaryId: c.subsidiaryId } }) : null;
    const managers = cfg?.managerUserIds?.length ? await this.userNames(cfg.managerUserIds) : [];
    const subsidiaryUsers = c.subsidiaryId ? (await this.alerts.subsidiaryUsers(c.subsidiaryId)).length : 0;
    return {
      consolidation: {
        id: c.id, consNumber: c.consNumber, uploadedAs: c.uploadedAs, uploadedAsKind: c.uploadedAsKind, kind: c.kind, kindLabel: KIND_LABEL[c.kind] ?? c.kind, receivedAt: c.receivedAt,
        subsidiaryId: c.subsidiaryId, subsidiaryName: sub?.name ?? null, inboxMessageId: c.inboxMessageId,
      },
      progress: {
        total: guides.length,
        unloaded: guides.filter((g) => g.unloaded).length,
        routed: guides.filter((g) => g.routed).length,
        closed: guides.filter((g) => g.closed).length,
      },
      findings,
      recipients: {
        groups: await this.alerts.generalGroups(),
        subsidiaryUsers,
        managers,
        numbers: cfg?.whatsappNumbers ?? [],
      },
    };
  }

  /** Vista previa (sin mandar) o envío. */
  async send(id: string, body: NoticeRequest, user: { userId: string | null; name: string | null }, scope: string[] | null, dryRun: boolean) {
    const a = await this.analyze(id, scope);
    const chosen = a.findings.filter((f) => (body.findings ?? []).includes(f.code));
    if (!chosen.length) throw new BadRequestException('Elige al menos un punto para el aviso');
    const t = body.targets ?? {};
    if (!t.groups && !t.subsidiary && !t.managers && !t.numbers) throw new BadRequestException('Elige a quién se manda');
    const c = a.consolidation;
    const subsidiaryName = c.subsidiaryName ?? 'Sin sucursal';
    const text = buildNoticeMessage({
      subsidiaryName, consNumber: c.consNumber, kindLabel: c.kindLabel, receivedAt: c.receivedAt, progress: a.progress,
      findings: chosen, note: body.note ?? null, senderName: user.name, withSamples: body.withSamples !== false,
      progressText: a.consolidation.uploadedAs && chosen.some((f) => f.code === 'tipo_equivocado')
        ? `Guías: ${c.kind === 'f2' ? 'subidas como paquete' : 'subidas como carga'} en ${a.consolidation.uploadedAs}`
        : null,
    });
    const title = `📣 Aviso · ${subsidiaryName} · ${c.kindLabel} ${c.consNumber}`;
    const plain = text.replace(/\*/g, '');

    const planned: { channel: string; recipientName: string }[] = [];
    if (t.groups) a.recipients.groups.forEach((g) => planned.push({ channel: 'whatsapp', recipientName: g.name }));
    if (t.numbers) a.recipients.numbers.forEach((n) => planned.push({ channel: 'whatsapp', recipientName: n }));
    const subUsers = t.subsidiary && c.subsidiaryId ? await this.alerts.subsidiaryUsers(c.subsidiaryId) : [];
    if (subUsers.length) planned.push({ channel: 'campana', recipientName: `${subUsers.length} usuario(s) de ${subsidiaryName}` });
    if (t.managers) a.recipients.managers.forEach((m) => planned.push({ channel: 'campana + correo', recipientName: m.name }));
    if (!planned.length) throw new BadRequestException('No hay a quién mandarlo con lo que elegiste (revisa grupos, números o encargados en Configuración)');
    if (dryRun) return { text, planned };

    const ctx = { origin: 'manual' as const, sentById: user.userId, sentByName: user.name, subsidiaryId: c.subsidiaryId, consNumber: c.consNumber, inboxMessageId: c.inboxMessageId };
    const results: SendResult[] = [];
    if (t.groups) for (const g of a.recipients.groups) results.push(await this.sendLog.whatsappTo(g, text, ctx, title));
    if (t.numbers) for (const n of a.recipients.numbers) results.push(await this.sendLog.whatsappTo({ id: n, name: n }, text, ctx, title));
    const event = { type: 'operacion.alertas', title, body: plain, severity: 'warning' as const, link: '/correos/seguimiento', entityId: c.id };
    if (subUsers.length) results.push(...(await this.sendLog.notifyUsers(subUsers, event, ctx, false)));
    if (t.managers && a.recipients.managers.length) results.push(...(await this.sendLog.notifyUsers(a.recipients.managers.map((m) => m.id), event, ctx, true)));
    return { text, results };
  }

  private async userNames(ids: string[]): Promise<{ id: string; name: string }[]> {
    if (!ids.length) return [];
    const rows: any[] = await this.ds.query(
      `SELECT id, email, TRIM(CONCAT(COALESCE(name, ''), ' ', COALESCE(lastName, ''))) AS name FROM \`user\` WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    return rows.map((r) => ({ id: r.id, name: r.name || r.email || r.id }));
  }
}
