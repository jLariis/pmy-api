// p-limit es ESM y rompe el parseo de jest al entrar por la cadena
// kpi.service -> consolidated.service -> shipments.service. Este test nunca
// ejercita ese codigo (instancia KpiService directamente), asi que se mockea.
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => (fn: any) => fn(),
}));

import { Between } from 'typeorm';
import { KpiService } from './kpi.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { MISSING_SCAN_REPORT_WINDOW } from 'src/inventories/missing-scan-report';

/**
 * Welcome dashboard — "Sin escaneo local" usa el MISMO motor que el reporte "Sin código 44":
 * el código lo dice FedEx (44 o 67, cualquiera cuenta, sin importar la config de la sucursal) y
 * "sin escaneo" = no está al día (nunca, o días completos sin escaneo en hora Hermosillo).
 */
describe('KpiService.getWelcomeDashboard — sin escaneo local (motor del reporte 44)', () => {
  const sub67 = { id: 's67', name: 'Huatabampo', monitorFedexCode44: false };
  const sub44 = { id: 's44', name: 'Hermosillo', monitorFedexCode44: true };

  // "Ahora" fijo: 10-oct-2026 09:00 Hermosillo.
  beforeAll(() => jest.useFakeTimers({ now: new Date('2026-10-10T16:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] }));
  afterAll(() => jest.useRealTimers());

  const ANOCHE = '2026-10-10T04:36:00Z';     // 09-oct 21:36 Hermosillo → al día
  const ANTENOCHE = '2026-10-09T04:36:00Z';  // 08-oct 21:36 → 1 día sin escaneo

  const mkShip = (id: string, subsidiary: any, code: string | null, ts = ANOCHE, extra: any = {}) => ({
    id, trackingNumber: id, recipientName: 'X', shipmentType: 'fedex', subsidiary,
    status: ShipmentStatusType.EN_BODEGA, createdAt: '2026-10-05T18:00:00Z',
    statusHistory: code ? [{ exceptionCode: code, timestamp: ts }] : [],
    ...extra,
  });

  /** QueryBuilder falso para el conteo de incidencias DHL por estatus. */
  const qbReturning = (rows: any[]) => () => {
    const qb: any = {};
    for (const m of ['select', 'addSelect', 'where', 'andWhere', 'groupBy']) qb[m] = jest.fn(() => qb);
    qb.getRawMany = jest.fn().mockResolvedValue(rows);
    return qb;
  };

  function svcWith(scanShipments: any[], subs = [sub67, sub44], scanCharges: any[] = [], findAndCount?: jest.Mock, incidentRows: any[] = []) {
    const svc = Object.create(KpiService.prototype) as any;
    svc.shipmentRepository = {
      findAndCount: findAndCount ?? jest.fn().mockResolvedValue([[], 0]), // secciones vencen/pendientes
      find: jest.fn().mockResolvedValue(scanShipments),   // sección "sin escaneo"
      createQueryBuilder: jest.fn(qbReturning(incidentRows)),
    };
    svc.chargeShipmentRepository = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      find: jest.fn().mockResolvedValue(scanCharges),
      createQueryBuilder: jest.fn(qbReturning([])),
    };
    svc.subsidiaryRepository = { find: jest.fn().mockResolvedValue(subs) };
    return svc;
  }

  it('sucursal configurada en 67 a la que FedEx manda el 44 → cuenta como escaneada (caso Obregón)', async () => {
    const svc = svcWith([
      mkShip('con44', sub67, '44'),   // FedEx dio 44 anoche → al día, NO aparece
      mkShip('con67', sub67, '67'),   // al día
      mkShip('sinNada', sub67, null), // nunca → aparece
    ]);
    const { stats, withoutDEXPackages } = await svc.getWelcomeDashboard();
    expect(stats.withoutDEX).toBe(1);
    expect(withoutDEXPackages[0].trackingNumber).toBe('sinNada');
    expect(withoutDEXPackages[0].missingDocument).toBe('Código 67 · Nunca escaneado');
  });

  it('sucursal de 44 que ya pasó a fase 67 → cuenta como escaneada', async () => {
    const svc = svcWith([mkShip('solo67', sub44, '67'), mkShip('nunca', sub44, null)]);
    const { stats, withoutDEXPackages } = await svc.getWelcomeDashboard();
    expect(stats.withoutDEX).toBe(1);
    expect(withoutDEXPackages[0].trackingNumber).toBe('nunca');
    expect(withoutDEXPackages[0].missingDocument).toBe('Código 44 · Nunca escaneado');
  });

  it('escaneada antenoche → aparece con 1 día sin escaneo y el último código de FedEx', async () => {
    const svc = svcWith([mkShip('viejo', sub67, '44', ANTENOCHE)]);
    const { withoutDEXPackages } = await svc.getWelcomeDashboard();
    expect(withoutDEXPackages).toHaveLength(1);
    expect(withoutDEXPackages[0].missingDocument).toBe('Código 44 · 1 día sin escaneo');
    expect(withoutDEXPackages[0].daysSinceLastCode).toBe(1);
  });

  it('deduplica por guía: el código en cualquier copia cuenta', async () => {
    const svc = svcWith(
      [mkShip('G1', sub67, null)],
      [sub67, sub44],
      [mkShip('G1', sub67, '67', ANOCHE, { id: 'G1-carga' })],
    );
    const { stats } = await svc.getWelcomeDashboard();
    expect(stats.withoutDEX).toBe(0);
  });

  it('nunca escaneadas primero, luego las de más días', async () => {
    const svc = svcWith([
      mkShip('uno', sub67, '67', ANTENOCHE),
      mkShip('nunca', sub67, null),
      mkShip('tres', sub67, '67', '2026-10-07T04:36:00Z'),
    ]);
    const { withoutDEXPackages } = await svc.getWelcomeDashboard();
    expect(withoutDEXPackages.map((p: any) => p.trackingNumber)).toEqual(['nunca', 'tres', 'uno']);
  });

  it('consulta igual que el reporte: pendiente/en bodega, solo FedEx, ventana del reporte, sin tope', async () => {
    const svc = svcWith([]);
    await svc.getWelcomeDashboard(['s67']);
    const call = svc.shipmentRepository.find.mock.calls[0][0];
    expect(call.where.status._value).toEqual([ShipmentStatusType.PENDIENTE, ShipmentStatusType.EN_BODEGA]);
    expect(call.where.shipmentType).toBe(ShipmentType.FEDEX);
    expect(call.where.createdAt).toEqual(Between(MISSING_SCAN_REPORT_WINDOW.from, MISSING_SCAN_REPORT_WINDOW.to));
    expect(call.take).toBeUndefined();
  });

  describe('FedEx y DHL nunca se mezclan', () => {
    const pkg = (id: string, shipmentType: string, status = ShipmentStatusType.EN_RUTA) => ({
      id, trackingNumber: id, recipientName: 'X', shipmentType, status,
      subsidiary: sub67, commitDateTime: '2026-10-10T20:00:00Z', createdAt: '2026-10-09T18:00:00Z',
    });

    it('cada sección se consulta por paquetería y trae su propio conteo', async () => {
      const fac = jest.fn(async ({ where }: any) => {
        if (where.shipmentType === 'fedex') return [[pkg('F1', 'fedex')], 3];
        if (where.shipmentType === 'dhl') return [[pkg('D1', 'dhl')], 2];
        return [[], 0];
      });
      const svc = svcWith([], [sub67], [], fac);
      const res = await svc.getWelcomeDashboard();
      // Ninguna consulta de vencen/pendientes/incidencias sin paquetería.
      expect(fac.mock.calls.every(([o]: any) => ['fedex', 'dhl'].includes(o.where.shipmentType))).toBe(true);
      expect(res.byCarrier.fedex.expiringToday).toBe(3);
      expect(res.byCarrier.dhl.expiringToday).toBe(2);
      expect(res.byCarrier.fedex.pendingYesterday).toBe(3);
      expect(res.byCarrier.dhl.pendingYesterday).toBe(2);
      expect(res.expiringPackages.map((p: any) => p.carrier).sort()).toEqual(['DHL', 'FedEx']);
    });

    it('DHL cuenta sus incidencias con SUS códigos (NH/BA/RD/CM), no 44/67', async () => {
      const svc = svcWith([], [sub67], [], undefined, [
        { status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE, n: '4' },
        { status: ShipmentStatusType.DIRECCION_INCORRECTA, n: '2' },
      ]);
      const res = await svc.getWelcomeDashboard();
      expect(res.byCarrier.dhl.incidents).toBe(6);
      expect(res.byCarrier.dhl.incidentsByCode).toEqual({
        NH: { label: 'Cliente no disponible', count: 4 },
        BA: { label: 'Dirección incorrecta', count: 2 },
      });
    });

    it('la lista de incidencias DHL etiqueta cada guía con su código DHL', async () => {
      const fac = jest.fn(async ({ where }: any) =>
        where.shipmentType === 'dhl' && where.createdAt ? [[pkg('D9', 'dhl', ShipmentStatusType.RECHAZADO)], 1] : [[], 0]);
      const svc = svcWith([], [sub67], [], fac);
      const res = await svc.getWelcomeDashboard();
      expect(res.dhlIncidentPackages).toHaveLength(1);
      expect(res.dhlIncidentPackages[0]).toMatchObject({ trackingNumber: 'D9', dhlCode: 'RD', incident: 'RD · Rechazado', carrier: 'DHL' });
    });
  });
});
