import { ConsolidadorReadService } from './consolidador-read.service';

const rows = [
  { id: '1', trackingNumber: 'T1', sourceType: 'shipment', incomeType: 'entregado', cost: '100', originalCost: null, date: new Date('2026-09-09'), charge: null, shipment: { id: 's1', status: 'entregado', routeId: 'r1', consolidatedId: 'co1' } },
  { id: '2', trackingNumber: null, sourceType: 'charge', incomeType: 'entregado', cost: '4000', originalCost: null, date: new Date('2026-09-09'), charge: { id: 'c1', consNumber: 'CN1' }, shipment: null },
  { id: '3', trackingNumber: null, sourceType: 'tyco', incomeType: 'tyco', cost: '50', originalCost: null, date: new Date('2026-09-09'), charge: null, shipment: null },
];

function repoMock() {
  const qb: any = {};
  ['leftJoinAndSelect', 'leftJoin', 'where', 'andWhere'].forEach((m) => (qb[m] = () => qb));
  qb.getMany = async () => rows;
  return { createQueryBuilder: () => qb } as any;
}

describe('ConsolidadorReadService.getWeek', () => {
  it('agrupa buckets y mapea filas', async () => {
    const svc = new ConsolidadorReadService(repoMock());
    const res = await svc.getWeek('sub', new Date('2026-09-07'), new Date('2026-09-13'), {});
    expect(res.rows).toHaveLength(3);
    expect(res.buckets.envios.amount).toBe(100);
    expect(res.buckets.cargas.amount).toBe(4000);
    expect(res.buckets.traslados.amount).toBe(50);
    expect(res.buckets.total.amount).toBe(4150);
    expect(res.buckets.total.count).toBe(3);
  });

  it('mapea ruta y consolidado del envío', async () => {
    const svc = new ConsolidadorReadService(repoMock());
    const res = await svc.getWeek('sub', new Date('2026-09-07'), new Date('2026-09-13'), {});
    const envio = res.rows.find((r) => r.id === '1');
    expect(envio?.routeId).toBe('r1');
    expect(envio?.consolidatedId).toBe('co1');
    const carga = res.rows.find((r) => r.id === '2');
    expect(carga?.consNumber).toBe('CN1');
  });
});
