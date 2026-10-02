import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { ConsolidationKind } from './inbox.types';
import { uploadMinutes } from './zip-coverage.util';

interface UploadHit {
  consNumber: string;
  at: Date;
  byId: string | null;
}

/** Tipos de import_file que cuentan como "subido" para cada tipo de consolidado del correo. */
const IMPORT_KINDS: Record<ConsolidationKind, string[]> = {
  master: ['master'],
  aereo: ['master'],
  high_value: ['high_value'],
  f2: ['f2'],
  dhl: [],
};

/**
 * Liga cada consolidado anunciado por correo con su subida real al sistema
 * (import_file → consolidated / charge) y guarda cuánto tardó.
 */
@Injectable()
export class InboxLinkService {
  private readonly logger = new Logger(InboxLinkService.name);

  constructor(
    @InjectRepository(InboxConsolidation) private readonly repo: Repository<InboxConsolidation>,
    private readonly ds: DataSource,
  ) {}

  async linkPending(limit = 500): Promise<{ linked: number }> {
    const pending = await this.repo.find({ where: { linkStatus: 'pendiente' }, order: { receivedAt: 'DESC' }, take: limit });
    if (!pending.length) return { linked: 0 };
    const hits = await this.findUploads(pending);
    let linked = 0;
    for (const p of pending) {
      const h = hits.get(`${p.kind}|${p.consNumber}`);
      if (!h) continue;
      p.uploadedAt = h.at;
      p.uploadedById = h.byId;
      p.uploadedVia = p.uploadedVia ?? 'manual';
      p.uploadMinutes = uploadMinutes(p.receivedAt, h.at);
      p.linkStatus = 'subido';
      await this.repo.save(p);
      linked++;
    }
    if (linked) this.logger.log(`🔗 [inbox] ${linked} consolidados ligados con su subida`);
    return { linked };
  }

  private async findUploads(list: InboxConsolidation[]): Promise<Map<string, UploadHit>> {
    const out = new Map<string, UploadHit>();
    const keep = (kind: ConsolidationKind, h: UploadHit) => {
      const k = `${kind}|${h.consNumber}`;
      const prev = out.get(k);
      if (!prev || h.at < prev.at) out.set(k, h);
    };
    const byKind = new Map<ConsolidationKind, string[]>();
    for (const c of list) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c.consNumber]);

    for (const [kind, nums] of byKind) {
      const ph = nums.map(() => '?').join(',');
      const importKinds = IMPORT_KINDS[kind];
      if (importKinds.length) {
        const rows: any[] = await this.ds.query(
          `SELECT consNumber, MIN(createdAt) AS at, MIN(uploadedById) AS byId FROM import_file
           WHERE consNumber IN (${ph}) AND kind IN (${importKinds.map(() => '?').join(',')}) GROUP BY consNumber`,
          [...nums, ...importKinds],
        );
        rows.forEach((r) => keep(kind, { consNumber: r.consNumber, at: new Date(r.at), byId: r.byId ?? null }));
      }
      const table = kind === 'f2' ? 'charge' : kind === 'high_value' ? null : 'consolidated';
      if (table) {
        const active = table === 'consolidated' ? 'AND active = 1' : '';
        const rows: any[] = await this.ds.query(
          `SELECT consNumber, MIN(createdAt) AS at, MIN(createdById) AS byId FROM \`${table}\`
           WHERE consNumber IN (${ph}) ${active} GROUP BY consNumber`,
          nums,
        );
        rows.forEach((r) => keep(kind, { consNumber: r.consNumber, at: new Date(r.at), byId: r.byId ?? null }));
      }
    }
    return out;
  }
}
