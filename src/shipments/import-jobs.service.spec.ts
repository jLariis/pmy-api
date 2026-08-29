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
