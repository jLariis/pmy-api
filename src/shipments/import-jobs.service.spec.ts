// p-limit v7 es ESM puro y rompe el transform de jest al colarse por el chain de
// imports (ConsolidatedService → shipments.service). Lo stubbeamos (no se usa aquí).
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ImportJobsService } from './import-jobs.service';
import { ImportJob } from '../entities/import-job.entity';
import { Shipment } from '../entities/shipment.entity';
import { ChargeShipment } from '../entities/charge-shipment.entity';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { HolidaysService } from 'src/holidays/holidays.service';
import { ShipmentsService } from './shipments.service';

function repoMock(extra: any = {}) {
  return { find: jest.fn(), findOne: jest.fn(), create: jest.fn((x) => x), save: jest.fn(async (x) => x), update: jest.fn(), ...extra };
}

describe('ImportJobsService.create (idempotencia)', () => {
  let service: ImportJobsService;
  let importJobRepo: any;

  beforeEach(async () => {
    importJobRepo = repoMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportJobsService,
        { provide: getRepositoryToken(ImportJob), useValue: importJobRepo },
        { provide: getRepositoryToken(Shipment), useValue: repoMock() },
        { provide: getRepositoryToken(ChargeShipment), useValue: repoMock() },
        { provide: DataSource, useValue: { createQueryRunner: jest.fn() } },
        { provide: ConsolidatedService, useValue: { findByConsNumberScoped: jest.fn().mockResolvedValue(null) } },
        { provide: HolidaysService, useValue: { getHolidayInputs: jest.fn().mockResolvedValue([]) } },
        { provide: ShipmentsService, useValue: { processFileF2: jest.fn(), addChargeShipments: jest.fn(), processFileCharges: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(ImportJobsService);
  });

  const dto = {
    kind: 'master' as const, subsidiaryId: 'S1', consNumber: 'C1',
    rows: [{ trackingNumber: '383012036065' }],
  };

  it('crea un job pending nuevo', async () => {
    importJobRepo.findOne.mockResolvedValue(null);
    importJobRepo.save.mockImplementation(async (j: any) => ({ ...j, id: 'JOB1' }));
    const res = await service.create(dto, { userId: 'U1' });
    expect(res.status).toBe('pending');
    expect(res.totalRows).toBe(1);
    expect(res.deduped).toBe(false);
    expect(importJobRepo.save).toHaveBeenCalled();
  });

  it('devuelve el job existente si hay uno reciente con el mismo hash (idempotencia)', async () => {
    importJobRepo.findOne.mockResolvedValue({ id: 'JOB0', status: 'processing', totalRows: 1 });
    const res = await service.create(dto, { userId: 'U1' });
    expect(res.jobId).toBe('JOB0');
    expect(res.deduped).toBe(true);
    expect(importJobRepo.save).not.toHaveBeenCalled();
  });
});

describe('ImportJobsService.processMasterJob', () => {
  let service: ImportJobsService;
  let qr: any;
  let jobRepo: any;

  function makeQR() {
    return {
      connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(), release: jest.fn(),
      manager: {
        create: jest.fn((_e: any, x: any) => x),
        update: jest.fn(),
        save: jest.fn(async (_e: any, x: any) => Array.isArray(x) ? x.map((r: any, i: number) => ({ ...r, id: `id${i}` })) : { ...x, id: 'x' }),
      },
    };
  }

  beforeEach(async () => {
    qr = makeQR();
    jobRepo = repoMock({ save: jest.fn(async (j: any) => j) });
    const dsManager = {
      findOne: jest.fn().mockResolvedValue({ id: 'S1', name: 'Hermosillo' }), // Subsidiary
      create: jest.fn((_e: any, x: any) => x),
      save: jest.fn(async (_e: any, x: any) => ({ ...x, id: 'CONS_NEW' })),   // Consolidated
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportJobsService,
        { provide: getRepositoryToken(ImportJob), useValue: jobRepo },
        { provide: getRepositoryToken(Shipment), useValue: repoMock({ find: jest.fn().mockResolvedValue([]) }) },
        { provide: getRepositoryToken(ChargeShipment), useValue: repoMock() },
        { provide: DataSource, useValue: { query: jest.fn().mockResolvedValue([{ l: 1 }]), manager: dsManager, createQueryRunner: () => qr } },
        { provide: ConsolidatedService, useValue: { findByConsNumberScoped: jest.fn().mockResolvedValue(null) } },
        { provide: HolidaysService, useValue: { getHolidayInputs: jest.fn().mockResolvedValue([]) } },
        { provide: ShipmentsService, useValue: { processFileF2: jest.fn(), addChargeShipments: jest.fn(), processFileCharges: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(ImportJobsService);
  });

  it('inserta todas las guías como PENDIENTE (sin FedEx) y marca done', async () => {
    const job: any = {
      id: 'J', kind: 'master', subsidiaryId: 'S1', consNumber: 'C1', isAereo: true,
      payloadRows: JSON.stringify([{ trackingNumber: 'A' }, { trackingNumber: 'B', cod: 'COD 1250' }]),
      onlyTrackings: null, totalRows: 2, saved: 0, duplicated: 0, recycled: 0, failed: 0, hvMarked: 0,
    };
    await service.processMasterJob(job);
    const savedShipments = qr.manager.save.mock.calls
      .filter((c: any[]) => Array.isArray(c[1]) && c[1][0]?.trackingNumber)
      .flatMap((c: any[]) => c[1]);
    expect(savedShipments.length).toBe(2);
    expect(savedShipments.every((s: any) => String(s.status).toLowerCase() === 'pendiente')).toBe(true);
    expect(job.saved).toBe(2);
    expect(job.status).toBe('done');
    expect(job.consolidatedId).toBe('CONS_NEW');
  });

  it('tolerancia: si el save del lote truena, marca partial y registra fallidas', async () => {
    qr.manager.save = jest.fn(async (_e: any, x: any) => { if (Array.isArray(x) && x[0]?.trackingNumber) throw new Error('DB down'); return x; });
    const job: any = {
      id: 'J2', kind: 'master', subsidiaryId: 'S1', consNumber: 'C1', isAereo: false,
      payloadRows: JSON.stringify([{ trackingNumber: 'A' }]),
      onlyTrackings: null, totalRows: 1, saved: 0, duplicated: 0, recycled: 0, failed: 0, hvMarked: 0,
    };
    await service.processMasterJob(job);
    expect(job.saved).toBe(0);
    expect(job.failed).toBe(1);
    expect(job.status).toBe('failed');
    expect(qr.rollbackTransaction).toHaveBeenCalled();
  });
});

describe('ImportJobsService.processChargeJob', () => {
  let service: ImportJobsService;
  let jobRepo: any;
  let shipments: any;

  beforeEach(async () => {
    jobRepo = repoMock({ save: jest.fn(async (j: any) => j) });
    shipments = {
      processFileF2: jest.fn().mockResolvedValue({ summary: { insertedNew: 1, migrated: 0, duplicated: 0, failed: 0 } }),
      addChargeShipments: jest.fn().mockResolvedValue({ savedChargeShipments: [{ id: 'x' }], duplicated: 0 }),
      processFileCharges: jest.fn().mockResolvedValue({ applied: 0, appliedToCharges: 1, unmatched: 0, unmatchedTrackings: [] }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportJobsService,
        { provide: getRepositoryToken(ImportJob), useValue: jobRepo },
        { provide: getRepositoryToken(Shipment), useValue: repoMock() },
        { provide: getRepositoryToken(ChargeShipment), useValue: repoMock() },
        { provide: DataSource, useValue: { query: jest.fn(), manager: {}, createQueryRunner: jest.fn() } },
        { provide: ConsolidatedService, useValue: { findByConsNumberScoped: jest.fn() } },
        { provide: HolidaysService, useValue: { getHolidayInputs: jest.fn().mockResolvedValue([]) } },
        { provide: ShipmentsService, useValue: shipments },
      ],
    }).compile();
    service = moduleRef.get(ImportJobsService);
  });

  it('inserta cargas (processFileF2) y aplica cobros (processFileCharges)', async () => {
    const job: any = {
      id: 'JC', kind: 'charge', subsidiaryId: 'S1', consNumber: 'C1', isHalfTon: false, notRemoveCharge: false,
      payloadRows: JSON.stringify([{ trackingNumber: 'A', cod: 'COD 500' }]),
      onlyTrackings: null, saved: 0, duplicated: 0, failed: 0, cobrosApplied: 0, cobrosUnmatched: 0,
    };
    await service.processChargeJob(job);
    expect(shipments.processFileF2).toHaveBeenCalled();
    expect(shipments.processFileCharges).toHaveBeenCalled();
    expect(job.saved).toBe(1);
    expect(job.cobrosApplied).toBe(1);
    expect(job.status).toBe('done');
  });

  it('con notRemoveCharge usa addChargeShipments (insertar directo)', async () => {
    const job: any = {
      id: 'JC2', kind: 'charge', subsidiaryId: 'S1', consNumber: 'C1', isHalfTon: false, notRemoveCharge: true,
      payloadRows: JSON.stringify([{ trackingNumber: 'A' }]),
      onlyTrackings: null, saved: 0, duplicated: 0, failed: 0, cobrosApplied: 0, cobrosUnmatched: 0,
    };
    await service.processChargeJob(job);
    expect(shipments.addChargeShipments).toHaveBeenCalled();
    expect(shipments.processFileF2).not.toHaveBeenCalled();
    expect(job.saved).toBe(1);
    expect(job.status).toBe('done');
  });
});
