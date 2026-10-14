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

describe('ShipmentsService.generateIncomes — misma pieza en otro consolidado', () => {
  function makeEm(siblingRows: any[]) {
    const save = jest.fn();
    const em = {
      query: jest.fn(async () => siblingRows),
      getRepository: jest.fn(() => ({ findOne: jest.fn(async () => null), save })),
      create: jest.fn((_e: any, data: any) => data),
    } as any;
    return { em, save };
  }
  const shipment = { id: 'nuevo', trackingNumber: '383894126080', status: 'entregado', active: true, subsidiary: { id: 'hmo', fedexCostPackage: 113 } };

  // Caso 383894126080 (Bodega Hermosillo, 13-oct-2026): la guía entró en dos consolidados y la
  // misma entrega se cobró en los dos registros. Cobra el primero; el otro la ve como ya cobrada.
  it('no cobra si otro registro de la misma pieza ya cobró ese evento', async () => {
    const svc = Object.create(ShipmentsService.prototype) as any;
    svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    const { em, save } = makeEm([{ id: 'i1', incomeType: 'entregado', date: '2026-10-13T20:07:00Z', shipmentId: 'viejo' }]);
    await svc.generateIncomes(shipment, new Date('2026-10-13T20:07:00Z'), undefined, em);
    expect(save).not.toHaveBeenCalled();
    const params = em.query.mock.calls[0][1];
    expect(params.slice(0, 3)).toEqual(['nuevo', '383894126080', 'entregado']);
  });

  it('sí cobra si ningún otro registro de la pieza cobró', async () => {
    const svc = Object.create(ShipmentsService.prototype) as any;
    svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    const { em, save } = makeEm([]);
    await svc.generateIncomes(shipment, new Date('2026-10-13T20:07:00Z'), undefined, em);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
