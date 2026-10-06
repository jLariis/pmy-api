// p-limit es ESM: se sustituye para poder cargar shipments.service en Jest.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { ShipmentsService } from './shipments.service';

describe('ShipmentsService.generateIncomes — guía dada de baja', () => {
  it('no crea ingreso si la guía está inactiva (consolidado eliminado)', async () => {
    const svc = Object.create(ShipmentsService.prototype) as any;
    svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    const em = { getRepository: jest.fn() } as any;
    await svc.generateIncomes(
      { id: 's1', trackingNumber: 'T1', status: 'entregado', active: false, subsidiary: { id: 'x', fedexCostPackage: 122 } },
      new Date(), undefined, em,
    );
    expect(em.getRepository).not.toHaveBeenCalled();
    expect(svc.logger.warn).toHaveBeenCalled();
  });
});
