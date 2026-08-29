import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In, MoreThan } from 'typeorm';
import { ImportJob } from '../entities/import-job.entity';
import { Shipment } from '../entities/shipment.entity';
import { ChargeShipment } from '../entities/charge-shipment.entity';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { HolidaysService } from 'src/holidays/holidays.service';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { CreateImportJobDto, PreviewImportDto } from './import-jobs.dto';
import { CanonicalRow } from './import-jobs.types';
import { parsePastedRows, hashRows, classifyMasterRows } from './import-jobs.util';

const IDEMPOTENCY_WINDOW_MS = 30 * 60 * 1000;
// Estatus que "cierran el ciclo" de una guía → un reingreso no re-marca.
const RETURN_STATUSES = ['devuelto_a_fedex'];

@Injectable()
export class ImportJobsService {
  private readonly logger = new Logger(ImportJobsService.name);
  private readonly BATCH = 100;

  constructor(
    @InjectRepository(ImportJob) private readonly jobRepo: Repository<ImportJob>,
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ChargeShipment) private readonly chargeShipmentRepo: Repository<ChargeShipment>,
    private readonly dataSource: DataSource,
    private readonly consolidatedService: ConsolidatedService,
    private readonly holidaysService: HolidaysService,
  ) {}

  async create(dto: CreateImportJobDto, user?: { userId?: string; name?: string }) {
    const { rows, totalRows } = parsePastedRows(dto.rows, dto.kind);
    const payloadHash = hashRows(rows);

    // Idempotencia: job reciente no-fallido con mismo (sucursal, kind, cons, hash).
    const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
    const existing = await this.jobRepo.findOne({
      where: {
        subsidiaryId: dto.subsidiaryId, kind: dto.kind, consNumber: dto.consNumber,
        payloadHash, status: In(['pending', 'processing', 'done', 'partial']),
        createdAt: MoreThan(since),
      },
      order: { createdAt: 'DESC' },
    });
    if (existing) return { jobId: existing.id, totalRows: existing.totalRows, status: existing.status, deduped: true };

    const job = this.jobRepo.create({
      kind: dto.kind, status: 'pending', source: dto.source === 'retry' ? 'retry' : 'paste',
      subsidiaryId: dto.subsidiaryId, consNumber: dto.consNumber,
      consDate: dto.consDate ? new Date(dto.consDate) : null,
      isAereo: !!dto.isAereo, isHalfTon: !!dto.isHalfTon, notRemoveCharge: !!dto.notRemoveCharge,
      label: `Paste ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      payloadHash, payloadRows: JSON.stringify(rows), totalRows,
      createdById: user?.userId ?? null, createdByName: user?.name ?? null,
    });
    const saved = await this.jobRepo.save(job);
    return { jobId: saved.id, totalRows, status: 'pending', deduped: false };
  }

  async preview(dto: PreviewImportDto) {
    let rows: CanonicalRow[];
    try { rows = parsePastedRows(dto.rows, dto.kind).rows; }
    catch (e: any) {
      return { withTracking: 0, newCount: 0, recycledCount: 0, alreadyImportedCount: 0, duplicatesInFile: 0, consNumberExists: null, parseError: e?.message ?? 'Pegado inválido' };
    }
    const cons = await this.consolidatedService.findByConsNumberScoped(dto.consNumber, dto.subsidiaryId, ShipmentType.FEDEX);
    const targetConsId = cons?.id ?? '__none__';
    const tns = rows.map((r) => r.trackingNumber);

    // Para charge: dedup contra charge_shipment por consNumber; para master: contra shipment por sucursal.
    const existing = new Map<string, { consolidatedId: string | null; status: string }>();
    if (dto.kind === 'master') {
      const found = tns.length ? await this.shipmentRepo.find({ where: { trackingNumber: In(tns), subsidiary: { id: dto.subsidiaryId } }, order: { createdAt: 'DESC' } }) : [];
      for (const s of found) if (!existing.has(s.trackingNumber)) existing.set(s.trackingNumber, { consolidatedId: s.consolidatedId, status: String(s.status) });
    } else {
      const found = tns.length ? await this.chargeShipmentRepo.find({ where: { trackingNumber: In(tns), consNumber: dto.consNumber } }) : [];
      for (const c of found) existing.set(c.trackingNumber, { consolidatedId: targetConsId, status: String(c.status) });
    }

    const cls = classifyMasterRows(rows, existing, targetConsId, RETURN_STATUSES);
    const duplicatesInFile = rows.length - new Set(tns).size;
    const alreadyImported = cls.duplicated.length - duplicatesInFile;
    return {
      withTracking: rows.length,
      newCount: cls.toInsert.length - cls.recycledTrackings.length,
      recycledCount: dto.kind === 'master' ? cls.recycledTrackings.length : 0,
      alreadyImportedCount: alreadyImported < 0 ? 0 : alreadyImported,
      duplicatesInFile,
      consNumberExists: cons ? { consNumber: cons.consNumber, isExactMatch: true } : null,
      parseError: null,
    };
  }

  async getById(id: string) {
    const j = await this.jobRepo.findOne({ where: { id } });
    if (!j) throw new NotFoundException('Job no encontrado');
    const { payloadRows, ...rest } = j as any;
    return rest;
  }

  list(subsidiaryId?: string, kind?: string, limit = 25) {
    const where: any = {};
    if (subsidiaryId) where.subsidiaryId = subsidiaryId;
    if (kind) where.kind = kind;
    return this.jobRepo.find({
      where, order: { createdAt: 'DESC' }, take: Math.min(limit, 100),
      select: {
        id: true, kind: true, status: true, subsidiaryId: true, consNumber: true, totalRows: true, saved: true,
        duplicated: true, recycled: true, failed: true, hvMarked: true, cobrosApplied: true, cobrosUnmatched: true,
        createdAt: true, finishedAt: true, createdByName: true,
      } as any,
    });
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));
  }
}
