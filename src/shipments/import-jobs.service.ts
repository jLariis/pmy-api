import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In, MoreThan } from 'typeorm';
import { ImportJob } from '../entities/import-job.entity';
import { Shipment } from '../entities/shipment.entity';
import { ChargeShipment } from '../entities/charge-shipment.entity';
import { Consolidated } from '../entities/consolidated.entity';
import { Subsidiary } from '../entities/subsidiary.entity';
import { ShipmentStatus } from '../entities/shipment-status.entity';
import { Payment } from '../entities/payment.entity';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { HolidaysService } from 'src/holidays/holidays.service';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';
import { PaymentStatus } from 'src/common/enums/payment-status.enum';
import { getPriority, parsePaymentCell } from 'src/utils/file-upload.utils';
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

  /** Toma un lock nombrado de MySQL mientras corre fn (evita consolidados duplicados). */
  private async withConsolidatedLock<T>(subsidiaryId: string, consNumber: string, fn: () => Promise<T>): Promise<T> {
    const key = `impcons:${subsidiaryId}:${consNumber}`;
    await this.dataSource.query('SELECT GET_LOCK(?, 10) AS l', [key]);
    try { return await fn(); }
    finally { await this.dataSource.query('SELECT RELEASE_LOCK(?) AS r', [key]); }
  }

  /** Marca shipments como Alto Valor (mismo criterio que processHihValueShipments). */
  private async markHighValue(manager: any, shipmentIds: string[]): Promise<void> {
    if (!shipmentIds.length) return;
    await manager.update(Shipment, { id: In(shipmentIds) }, { isHighValue: true });
  }

  /**
   * Estrategia master: inserta envíos como PENDIENTE (con pago y Alto Valor), en lotes
   * cortos con commit parcial. NO llama a FedEx — el cron existente enriquece después.
   */
  async processMasterJob(job: ImportJob): Promise<void> {
    const allRows = JSON.parse(job.payloadRows) as CanonicalRow[];
    const only = job.onlyTrackings ? new Set(JSON.parse(job.onlyTrackings) as string[]) : null;
    const work = only ? allRows.filter((r) => only.has(r.trackingNumber)) : allRows;

    const result = { failedTrackings: [] as { trackingNumber: string; reason: string }[], duplicatedTrackings: [] as string[], cobrosUnmatchedTrackings: [] as string[], summary: {} as Record<string, number> };
    const tns = work.map((r) => r.trackingNumber);

    // Históricos por guía (para clasificar nueva/reingreso/duplicada).
    const existingRows = tns.length
      ? await this.shipmentRepo.find({ where: { trackingNumber: In(tns), subsidiary: { id: job.subsidiaryId } }, order: { createdAt: 'DESC' } })
      : [];
    const existing = new Map<string, { consolidatedId: string | null; status: string; id: string }>();
    for (const s of existingRows) if (!existing.has(s.trackingNumber)) existing.set(s.trackingNumber, { consolidatedId: s.consolidatedId, status: String(s.status), id: s.id });

    await this.withConsolidatedLock(job.subsidiaryId, job.consNumber, async () => {
      const manager = this.dataSource.manager;
      const predefinedSub = await manager.findOne(Subsidiary, { where: { id: job.subsidiaryId } });
      if (!predefinedSub) throw new Error('Subsidiaria no encontrada');

      // Consolidado find-or-create (dentro del lock).
      const cons = await this.consolidatedService.findByConsNumberScoped(job.consNumber, job.subsidiaryId, ShipmentType.FEDEX);
      let consolidatedId = cons?.id ?? null;
      if (!consolidatedId) {
        const created = await manager.save(Consolidated, manager.create(Consolidated, {
          date: job.consDate ?? new Date(),
          type: job.isAereo ? ConsolidatedType.AEREO : ConsolidatedType.ORDINARIA,
          numberOfPackages: 0, subsidiary: predefinedSub, consNumber: job.consNumber,
          isCompleted: false, efficiency: 0, commitDateTime: new Date(), createdById: job.createdById,
        }));
        consolidatedId = created.id;
      }
      job.consolidatedId = consolidatedId;

      const cls = classifyMasterRows(work, existing as any, consolidatedId, RETURN_STATUSES);
      result.duplicatedTrackings = cls.duplicated.map((r) => r.trackingNumber);
      job.duplicated = result.duplicatedTrackings.length;
      job.recycled = cls.recycledTrackings.length;
      const markReturned = new Set(cls.toMarkReturned);

      for (const batch of this.chunk(cls.toInsert, this.BATCH)) {
        const qr = this.dataSource.createQueryRunner();
        await qr.connect();
        await qr.startTransaction();
        try {
          const now = new Date();
          const prepared: { entity: any; payment: any | null; isHighValue: boolean }[] = [];
          for (const row of batch) {
            try {
              const commit = row.commitDate && row.commitTime ? new Date(`${row.commitDate}T${row.commitTime}`) : new Date();
              const commitDateTime = isNaN(commit.getTime()) ? now : commit;
              const entity = qr.manager.create(Shipment, {
                trackingNumber: row.trackingNumber, shipmentType: ShipmentType.FEDEX,
                recipientName: row.recipientName || 'N/A', recipientAddress: row.recipientAddress || 'N/A',
                recipientCity: row.recipientCity || predefinedSub.name, recipientZip: row.recipientZip || 'N/A',
                recipientPhone: row.recipientPhone || 'N/A', priority: getPriority(commitDateTime),
                commitDateTime, consNumber: job.consNumber, status: ShipmentStatusType.PENDIENTE,
                createdAt: now, createdById: job.createdById, subsidiary: predefinedSub, consolidatedId,
              });
              const pay = parsePaymentCell(row.cod);
              const payment = pay ? { amount: pay.amount, type: pay.type, status: PaymentStatus.PENDING, createdAt: now } : null;
              prepared.push({ entity, payment, isHighValue: row.isHighValue === true });
            } catch (e: any) {
              result.failedTrackings.push({ trackingNumber: row.trackingNumber, reason: e?.message ?? 'map error' });
            }
          }

          // Reingresos: marcar viejos como DEVUELTO_A_FEDEX + nota.
          for (const row of batch) {
            if (!markReturned.has(row.trackingNumber)) continue;
            const prev = existing.get(row.trackingNumber);
            if (!prev) continue;
            await qr.manager.update(Shipment, { id: prev.id }, { status: ShipmentStatusType.DEVUELTO_A_FEDEX });
            await qr.manager.save(ShipmentStatus, qr.manager.create(ShipmentStatus, {
              status: ShipmentStatusType.DEVUELTO_A_FEDEX, notes: 'Reingreso detectado por import (paste).',
              timestamp: now, shipment: { id: prev.id }, exceptionCode: 'AUTO-RETURN',
            }));
          }

          const savedShipments = prepared.length ? await qr.manager.save(Shipment, prepared.map((p) => p.entity), { chunk: 50 }) : [];
          const payments: any[] = []; const histories: any[] = []; const hvIds: string[] = [];
          savedShipments.forEach((s: Shipment, i: number) => {
            const src = prepared[i];
            if (src.payment) payments.push({ ...src.payment, shipment: { id: s.id } });
            if (src.isHighValue) hvIds.push(s.id);
            histories.push(qr.manager.create(ShipmentStatus, {
              status: ShipmentStatusType.PENDIENTE, notes: `Registro inicial. Cons: ${job.consNumber}`,
              timestamp: now, shipment: { id: s.id }, exceptionCode: 'INIT',
            }));
          });
          if (payments.length) await qr.manager.save(Payment, payments);
          if (histories.length) await qr.manager.save(ShipmentStatus, histories);
          if (hvIds.length) { await this.markHighValue(qr.manager, hvIds); job.hvMarked += hvIds.length; }

          await qr.commitTransaction();
          job.saved += savedShipments.length;
          job.processedRows += batch.length;
          job.heartbeatAt = new Date();
          await this.jobRepo.save(job);
        } catch (e: any) {
          await qr.rollbackTransaction();
          for (const row of batch) result.failedTrackings.push({ trackingNumber: row.trackingNumber, reason: e?.message ?? 'batch error' });
        } finally {
          await qr.release();
        }
      }
    });

    job.failed = result.failedTrackings.length;
    job.result = JSON.stringify(result);
    job.status = job.saved === 0 && job.failed > 0 ? 'failed' : (job.failed > 0 ? 'partial' : 'done');
    job.finishedAt = new Date();
    await this.jobRepo.save(job);
  }
}
