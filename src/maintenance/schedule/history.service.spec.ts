import { HistoryService } from './history.service';

const qb = (result: any[]) => {
  const q: any = {};
  for (const k of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy']) q[k] = jest.fn(() => q);
  q.getMany = jest.fn(async () => result);
  return q;
};

describe('HistoryService', () => {
  it('agrupa por unidad y separa registros previos', async () => {
    const v1 = { id: 'v1', name: 'Van 1', lastMaintenanceDate: new Date('2026-09-01'), lastMaintenanceKms: 90000 };
    const v2 = { id: 'v2', name: 'Van 2', lastMaintenanceDate: new Date('2026-03-01') };
    const orders: any = {
      createQueryBuilder: jest.fn(() => qb([
        { id: 'a', folio: 'OC-1', vehicle: v1, supplier: { name: 'T' }, finalAmount: 1000, total: 900, items: [{ description: 'Aceite', approved: true }, { description: 'X', approved: false }] },
        { id: 'b', folio: 'OC-2', vehicle: v1, supplier: { name: 'T' }, finalAmount: null, total: 500.5, items: [] },
      ])),
    };
    const vehicles: any = { createQueryBuilder: jest.fn(() => qb([v1, v2])) };
    const r = await new HistoryService(orders, vehicles).bySubsidiary('s1');
    expect(r.rows[0]).toMatchObject({ folio: 'OC-1', amount: 1000, services: ['Aceite'] });
    expect(r.byVehicle).toEqual([expect.objectContaining({ count: 2, total: 1500.5, lastMaintenanceKms: 90000 })]);
    expect(r.legacy.map((l) => l.vehicle.id)).toEqual(['v2']);
  });

  it('las órdenes de compra sin unidad no entran al historial de mantenimiento (ni lo tiran)', async () => {
    const v1 = { id: 'v1', name: 'Van 1' };
    const q = qb([
      { id: 'a', folio: 'OC-1', vehicle: v1, supplier: { name: 'T' }, finalAmount: 100, total: 100, items: [] },
      { id: 'c', folio: 'OC-9', vehicle: null, vehicleId: null, supplier: { name: 'Office' }, finalAmount: 50, total: 50, items: [] },
    ]);
    const orders: any = { createQueryBuilder: jest.fn(() => q) };
    const vehicles: any = { createQueryBuilder: jest.fn(() => qb([v1])) };
    const r = await new HistoryService(orders, vehicles).bySubsidiary('s1');
    expect(q.andWhere).toHaveBeenCalledWith('po.vehicleId IS NOT NULL');
    expect(r.rows.map((x) => x.folio)).toEqual(['OC-1']);
    expect(r.byVehicle).toHaveLength(1);
  });
});
