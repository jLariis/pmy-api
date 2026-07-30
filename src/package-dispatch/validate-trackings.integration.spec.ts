// p-limit es ESM puro y jest no lo transforma; lo stubeamos porque la cadena de
// imports de PackageDispatchService lo arrastra (vía shipments.service).
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { BadRequestException } from '@nestjs/common';
import { PackageDispatchService } from './package-dispatch.service';

describe('PackageDispatchService.validateTrackingsList', () => {
  // Fabrica un service con solo las dependencias que toca el método batch.
  const makeSvc = (opts: { sortByCp?: boolean; byCode?: Record<string, any> }) => {
    const svc = Object.create(PackageDispatchService.prototype) as any;
    svc.subsidiaryRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'sub-1', sortDispatchByPostalCode: opts.sortByCp }),
    };
    // Reusa la lógica real uno-por-uno: la mockeamos para aislar el batch.
    svc.validateTrackingNumber = jest.fn(async (code: string) => (opts.byCode ?? {})[code] ?? { trackingNumber: code, isValid: true });
    return svc;
  };

  it('valida toda la lista en un solo request (un validateTrackingNumber por código)', async () => {
    const svc = makeSvc({ sortByCp: false });
    const out = await svc.validateTrackingsList({ trackingNumbers: ['A', 'B', 'C'], subsidiaryId: 'sub-1' });
    expect(svc.validateTrackingNumber).toHaveBeenCalledTimes(3);
    expect(out.map((p: any) => p.trackingNumber)).toEqual(['A', 'B', 'C']);
  });

  it('dedupe conservando orden de escaneo (primer índice gana)', async () => {
    const svc = makeSvc({ sortByCp: false });
    const out = await svc.validateTrackingsList({ trackingNumbers: ['A', 'B', 'A', ' ', 'C'], subsidiaryId: 'sub-1' });
    expect(svc.validateTrackingNumber).toHaveBeenCalledTimes(3);
    expect(out.map((p: any) => p.trackingNumber)).toEqual(['A', 'B', 'C']);
  });

  it('ordena por CP cuando sortDispatchByPostalCode = true', async () => {
    const byCode = {
      A: { trackingNumber: 'A', recipientZip: '85000', isValid: true },
      B: { trackingNumber: 'B', recipientZip: '01000', isValid: true },
      C: { trackingNumber: 'C', recipientZip: '44100', isValid: true },
    };
    const svc = makeSvc({ sortByCp: true, byCode });
    const out = await svc.validateTrackingsList({ trackingNumbers: ['A', 'B', 'C'], subsidiaryId: 'sub-1' });
    expect(out.map((p: any) => p.recipientZip)).toEqual(['01000', '44100', '85000']);
  });

  it('conserva orden de escaneo cuando sortDispatchByPostalCode = false', async () => {
    const byCode = {
      A: { trackingNumber: 'A', recipientZip: '85000', isValid: true },
      B: { trackingNumber: 'B', recipientZip: '01000', isValid: true },
    };
    const svc = makeSvc({ sortByCp: false, byCode });
    const out = await svc.validateTrackingsList({ trackingNumbers: ['A', 'B'], subsidiaryId: 'sub-1' });
    expect(out.map((p: any) => p.recipientZip)).toEqual(['85000', '01000']);
  });

  it('lista vacía → BadRequestException', async () => {
    const svc = makeSvc({});
    await expect(svc.validateTrackingsList({ trackingNumbers: [], subsidiaryId: 'sub-1' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
