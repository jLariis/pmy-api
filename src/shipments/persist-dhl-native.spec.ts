// p-limit es ESM puro y jest no lo transforma; shipments.service lo importa a nivel módulo.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { ShipmentsService } from './shipments.service';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';
import type { DhlNativeResult } from './dhl.service';

/** tem (EntityManager transaccional) simulado: save + update encadenable. */
function makeTem() {
  const execute = jest.fn().mockResolvedValue(undefined);
  const save = jest.fn().mockResolvedValue(undefined);
  const createQueryBuilder = jest.fn(() => ({
    update: () => ({ set: () => ({ where: () => ({ execute }) }) }),
  }));
  return { save, createQueryBuilder, execute };
}

function svcWith(shipments: any[], generateIncomes = jest.fn().mockResolvedValue(undefined)) {
  const svc = Object.create(ShipmentsService.prototype) as any;
  svc.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
  const tem = makeTem();
  const find = jest.fn().mockResolvedValue(shipments);
  svc.shipmentRepository = {
    find,
    manager: { transaction: (cb: any) => cb(tem) },
  };
  svc.generateIncomes = generateIncomes;
  svc.__tem = tem;
  svc.__find = find;
  return svc;
}

const mkShip = (over: Partial<any> = {}) => ({
  id: 's1',
  trackingNumber: '2620515634',
  dhlUniqueId: 'JD014600012805900102',
  statusHistory: [],
  subsidiary: { id: 'sub1', generateDhlIncomeOnDelivery: true },
  ...over,
});

const delivered: DhlNativeResult = {
  queryTrackingNumber: '4218248764',
  found: true,
  statusCode: 'delivered',
  eventCode: 'OK',
  timestamp: '2026-09-05T14:16:00-07:00',
  description: 'Delivered',
  pieceIds: ['JD014600012809178690'],
};

describe('ShipmentsService.persistDhlNativeResults', () => {
  it('MULTI-PIEZA: entrega actualiza TODAS las piezas de la guía y cobra en cada una', async () => {
    const p1 = mkShip({ id: 'a', dhlUniqueId: 'JDPIECE1' });
    const p2 = mkShip({ id: 'b', dhlUniqueId: 'JDPIECE2' });
    const gen = jest.fn().mockResolvedValue(undefined);
    const svc = svcWith([p1, p2], gen);

    const res = await svc.persistDhlNativeResults([{
      ...delivered, pieceIds: ['JDPIECE1', 'JDPIECE2'],
    }]);

    expect(res.updated).toHaveLength(2);
    expect(res.updated.map((u: any) => u.status)).toEqual([
      ShipmentStatusType.ENTREGADO, ShipmentStatusType.ENTREGADO,
    ]);
    // Ingreso en entrega para cada pieza (sucursal con el flag activo).
    expect(gen).toHaveBeenCalledTimes(2);
    // El match usa trackingNumber + cada pieceId.
    expect(svc.__find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.arrayContaining([
        { trackingNumber: '4218248764' },
        { dhlUniqueId: 'JDPIECE1' },
        { dhlUniqueId: 'JDPIECE2' },
      ]),
    }));
  });

  it('NO cobra si la sucursal no tiene generateDhlIncomeOnDelivery', async () => {
    const gen = jest.fn().mockResolvedValue(undefined);
    const svc = svcWith([mkShip({ subsidiary: { id: 'sub1', generateDhlIncomeOnDelivery: false } })], gen);
    const res = await svc.persistDhlNativeResults([delivered]);
    expect(res.updated).toHaveLength(1);
    expect(gen).not.toHaveBeenCalled();
  });

  it('DEDUPE: mismo estatus el mismo día y no más nuevo → sin cambio, no cobra', async () => {
    const eventDate = new Date('2026-09-05T14:16:00-07:00');
    const ship = mkShip({
      statusHistory: [{ status: ShipmentStatusType.ENTREGADO, timestamp: eventDate }],
    });
    const gen = jest.fn();
    const svc = svcWith([ship], gen);
    const res = await svc.persistDhlNativeResults([delivered]);
    expect(res.unchanged).toContain(ship.trackingNumber);
    expect(res.updated).toHaveLength(0);
    expect(gen).not.toHaveBeenCalled();
  });

  it('tránsito → EN_RUTA, sin cobro', async () => {
    const gen = jest.fn();
    const svc = svcWith([mkShip()], gen);
    const res = await svc.persistDhlNativeResults([{
      queryTrackingNumber: '2620515634', found: true, statusCode: 'transit', eventCode: 'FD',
      timestamp: '2026-09-04T14:00:00-07:00', description: 'Forwarded', pieceIds: ['JD014600012805900102'],
    }]);
    expect(res.updated[0].status).toBe(ShipmentStatusType.EN_RUTA);
    expect(gen).not.toHaveBeenCalled();
  });

  it('found=false → notFound (no consulta la BD)', async () => {
    const svc = svcWith([]);
    const res = await svc.persistDhlNativeResults([{ queryTrackingNumber: 'X', found: false, pieceIds: [] }]);
    expect(res.notFound).toContain('X');
    expect(svc.__find).not.toHaveBeenCalled();
  });

  it('estatus desconocido → skipped', async () => {
    const svc = svcWith([mkShip()]);
    const res = await svc.persistDhlNativeResults([{
      queryTrackingNumber: '2620515634', found: true, statusCode: 'unknown', pieceIds: [],
    }]);
    expect(res.skipped).toContain('2620515634');
    expect(res.updated).toHaveLength(0);
  });

  it('guía no encontrada en BD → notFound', async () => {
    const svc = svcWith([]); // find devuelve []
    const res = await svc.persistDhlNativeResults([delivered]);
    expect(res.notFound).toContain(delivered.queryTrackingNumber);
  });
});
