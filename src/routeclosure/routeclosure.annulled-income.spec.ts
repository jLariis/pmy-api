// p-limit es ESM puro y jest no transforma node_modules (ver routeclosure.closure-fixes.spec).
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { RouteclosureService } from './routeclosure.service';
import { Income } from 'src/entities';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

/**
 * Caso ruta 604005759064 (Hermosillo, sáb 10-oct-2026), guía 878249671370: la guía entró dos
 * veces (consolidados 09 y 10-oct). El ingreso del registro viejo quedó ANULADO por una
 * devolución (+52 y su reversa −52, ambas active=0). El cierre de la ruta del 10-oct tomaba esas
 * filas anuladas como "ya cobrado" y no creaba el ingreso del registro nuevo.
 */
function makeService(rows: any[], siblingRows: any[] = []) {
  const saved: any[] = [];
  // Simula el filtro de la BD: where simple o arreglo (OR); `shipment: { id }` compara contra
  // row.shipmentId y `shipment: IsNull()` exige row.shipmentId == null.
  const matchField = (row: any, k: string, v: any) => {
    if (k !== 'shipment') return row[k] === v;
    if (v && typeof v === 'object' && 'id' in v) return row.shipmentId === v.id;
    return row.shipmentId == null;
  };
  const matches = (row: any, where: any) =>
    (Array.isArray(where) ? where : [where]).some((w) => Object.entries(w).every(([k, v]) => matchField(row, k, v)));
  const incomeRepo: any = {
    find: jest.fn(async ({ where }: any) => rows.filter((r) => matches(r, where))),
    create: jest.fn((data: any) => data),
    save: jest.fn(async (data: any) => {
      saved.push(data);
      return data;
    }),
    update: jest.fn(),
  };
  const svc = Object.create(RouteclosureService.prototype) as any;
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc.dataSource = {
    getRepository: (entity: any) => {
      if (entity === Income) return incomeRepo;
      return { find: jest.fn(async () => []) };
    },
    // Ingresos de OTRO registro de la misma pieza (siblingIncomesSinceCreated).
    manager: { query: jest.fn(async () => siblingRows) },
  };
  return { svc, saved, incomeRepo };
}

const dispatch: any = {
  id: '9d185159',
  is315: false,
  routeDate: new Date('2026-10-10T07:00:00Z'),
  subsidiary: { id: 'hmo', name: 'Hermosillo', fedexCostPackage: 52 },
};

const delivered: any = {
  kind: 'shipment',
  trackingNumber: '878249671370',
  shipmentId: 'nuevo',
  toStatus: ShipmentStatusType.ENTREGADO,
  eventAt: '2026-10-10T15:52:00.000Z',
};

const annulledRows = [
  { id: 'a', shipmentId: 'viejo', trackingNumber: '878249671370', sourceType: IncomeSourceType.SHIPMENT, incomeType: IncomeStatus.ENTREGADO, cost: 52, active: false },
  { id: 'b', shipmentId: 'viejo', trackingNumber: '878249671370', sourceType: IncomeSourceType.SHIPMENT, incomeType: IncomeStatus.ENTREGADO, cost: -52, active: false },
];

describe('RouteclosureService.reconcileRouteIncome — ingresos anulados', () => {
  it('un ingreso anulado (y su reversa) de otro registro de la guía no bloquea el cobro del cierre', async () => {
    const { svc, saved } = makeService(annulledRows);
    const res = await svc.reconcileRouteIncome(dispatch, [delivered], 'user-1');
    expect(res.incomeCreated).toBe(1);
    expect(saved[0]).toMatchObject({
      trackingNumber: '878249671370',
      incomeType: IncomeStatus.ENTREGADO,
      cost: 52,
      shipment: { id: 'nuevo' },
    });
  });

  it('un ingreso VIVO de otro registro (consolidado anterior) de la misma guía no bloquea: el ingreso es por shipment', async () => {
    const { svc, saved } = makeService([{ ...annulledRows[0], id: 'c', active: true }]);
    const res = await svc.reconcileRouteIncome(dispatch, [delivered], 'user-1');
    expect(res.incomeCreated).toBe(1);
    expect(saved[0].shipment).toEqual({ id: 'nuevo' });
  });

  it('un ingreso ENTREGADO vivo del MISMO shipment sí bloquea (no duplica)', async () => {
    const { svc, saved } = makeService([{ ...annulledRows[0], id: 'c', shipmentId: 'nuevo', active: true }]);
    const res = await svc.reconcileRouteIncome(dispatch, [delivered], 'user-1');
    expect(res.incomeCreated).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('un ingreso vivo de la guía SIN shipment (huérfano) bloquea para no cobrar doble', async () => {
    const { svc, saved } = makeService([{ ...annulledRows[0], id: 'd', shipmentId: null, active: true }]);
    const res = await svc.reconcileRouteIncome(dispatch, [delivered], 'user-1');
    expect(res.incomeCreated).toBe(0);
    expect(saved).toHaveLength(0);
  });
});

// Caso 383894126080 (Bodega Hermosillo, 13-oct-2026): la guía entró en dos consolidados; el cron
// le cobró la entrega al registro viejo y el cierre de la ruta del registro nuevo la cobraba otra vez.
describe('RouteclosureService.reconcileRouteIncome — ya cobrada en otro registro de la guía', () => {
  it('no crea ingreso si otro registro de la misma pieza ya cobró la entrega después del alta', async () => {
    const sibling = [{ id: 'x', incomeType: IncomeStatus.ENTREGADO, date: new Date('2026-10-10T20:07:00Z'), shipmentId: 'viejo' }];
    const { svc, saved } = makeService([], sibling);
    const res = await svc.reconcileRouteIncome(dispatch, [delivered], 'user-1');
    expect(res.incomeCreated).toBe(0);
    expect(saved).toHaveLength(0);
  });

  // Igual que el cron: solo la semana del evento. Un DEX de otra semana en el otro registro no
  // debe bloquear un cobro legítimo de ésta.
  it('busca lo cobrado por el otro registro solo en la semana del evento', async () => {
    const { svc } = makeService([], []);
    await svc.reconcileRouteIncome(dispatch, [delivered], 'user-1');
    const [, params] = svc.dataSource.manager.query.mock.calls[0];
    const [from, to] = params.slice(2);
    expect(from.getTime()).toBeLessThanOrEqual(new Date(delivered.eventAt).getTime());
    expect(to.getTime()).toBeGreaterThanOrEqual(new Date(delivered.eventAt).getTime());
    expect(to.getTime() - from.getTime()).toBeLessThan(7 * 24 * 3600e3);
  });
});
