import { Between } from 'typeorm';
import { InventoriesService, MISSING_SCAN_REPORT_WINDOW } from './inventories.service';

/**
 * Reporte "Sin código 44 por sucursal/zona" (bug: no salía para ninguna sucursal porque estaba
 * anclado a inventarios en rango, y las sucursales que monitorean 44 —Hermosillo / Ruta Extendida—
 * casi no crean inventarios). Rediseño: lista los paquetes ACTIVOS (pendiente/en_bodega) por
 * sucursal, con el código de escaneo de CADA sucursal (44 si `monitorFedexCode44`, si no 67).
 */
describe('InventoriesService.getMissingScanReportMulti', () => {
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000);

  function mkShip(over: Partial<any> & { subId: string; exceptionCode?: string | null }) {
    const { subId, exceptionCode, ...rest } = over;
    return {
      trackingNumber: rest.trackingNumber ?? 'T',
      status: 'en_bodega',
      recipientName: 'X',
      recipientAddress: 'A', recipientCity: 'C', recipientZip: '00000',
      shipmentType: 'fedex', fedexUniqueId: null, commitDateTime: null,
      createdAt: hoursAgo(48),
      subsidiary: { id: subId, name: subId },
      statusHistory: exceptionCode ? [{ exceptionCode, timestamp: hoursAgo(2) }] : [],
      ...rest,
    };
  }

  function svcWith(subsidiaries: any[], shipments: any[]) {
    const svc = Object.create(InventoriesService.prototype) as any;
    svc.subsidiaryRepository = { find: jest.fn().mockResolvedValue(subsidiaries) };
    svc.shipmentRepository = { find: jest.fn().mockResolvedValue(shipments) };
    svc.chargeShipmentRepository = { find: jest.fn().mockResolvedValue([]) };
    return svc;
  }

  const SUB44 = { id: 's44', name: 'Hermosillo', monitorFedexCode44: true };
  const SUB67 = { id: 's67', name: 'Puerto Peñasco', monitorFedexCode44: false };

  it('sucursal de código 44: paquete con escaneo 44 hoy → categoría "hoy"', async () => {
    const svc = svcWith([SUB44], [mkShip({ subId: 's44', trackingNumber: 'A', exceptionCode: '44' })]);
    const { details } = await svc.getMissingScanReportMulti(['s44']);
    expect(details).toHaveLength(1);
    expect(details[0].category).toBe('hoy');
    expect(details[0].scanCode).toBe('44');
  });

  it('sucursal de código 67: paquete con escaneo 67 hoy → categoría "hoy"', async () => {
    const svc = svcWith([SUB67], [mkShip({ subId: 's67', trackingNumber: 'B', exceptionCode: '67' })]);
    const { details } = await svc.getMissingScanReportMulti(['s67']);
    expect(details[0].category).toBe('hoy');
    expect(details[0].scanCode).toBe('67');
  });

  it('sucursal de código 44: paquete SIN 44 → categoría "nunca" y aparece en el reporte', async () => {
    const svc = svcWith([SUB44], [mkShip({ subId: 's44', trackingNumber: 'C', exceptionCode: null })]);
    const { details, summary } = await svc.getMissingScanReportMulti(['s44']);
    expect(details[0].category).toBe('nunca');
    expect(summary.paquetes).toBe(1);
    expect(summary.nunca).toBe(1);
    expect(summary.sinCodigo).toBe(0); // los "nunca" no se cuentan dos veces
  });

  it('multi-sucursal: cada fila trae su código; sin escaneo usa el configurado', async () => {
    const svc = svcWith(
      [SUB44, SUB67],
      [
        mkShip({ subId: 's44', trackingNumber: 'A', exceptionCode: null }),
        mkShip({ subId: 's67', trackingNumber: 'B', exceptionCode: null }),
      ],
    );
    const { details } = await svc.getMissingScanReportMulti(['s44', 's67']);
    const byTn = Object.fromEntries(details.map((d: any) => [d.trackingNumber, d]));
    expect(byTn.A.scanCode).toBe('44');
    expect(byTn.B.scanCode).toBe('67');
  });

  // Caso real 2026-10-09 (519750418785 Huatabampo / 383851714183 Villa Juárez): sucursales
  // configuradas en 67 cuyo FedEx (estación Obregón) reporta el 44 todos los días. El reporte
  // decía "sin código" aunque FedEx sí lo escaneó. El código lo dice FedEx, no la configuración.
  it('sucursal configurada en 67 pero FedEx reporta 44 → cuenta como con código (44)', async () => {
    const svc = svcWith([SUB67], [mkShip({ subId: 's67', trackingNumber: 'B', exceptionCode: '44' })]);
    const { details } = await svc.getMissingScanReportMulti(['s67']);
    expect(details[0].category).toBe('hoy');
    expect(details[0].scanCode).toBe('44');
  });

  it('sucursal de 44 que ya pasó a fase 67 (tercero en camino) → cuenta como con código (67)', async () => {
    const svc = svcWith([SUB44], [mkShip({ subId: 's44', trackingNumber: 'A', exceptionCode: '67' })]);
    const { details } = await svc.getMissingScanReportMulti(['s44']);
    expect(details[0].category).toBe('hoy');
    expect(details[0].scanCode).toBe('67');
  });

  // FedEx escanea de noche (~21:30–23:00 Hermosillo). "Días sin código" = días COMPLETOS que
  // faltó el escaneo (en hora de Hermosillo); el de hoy todavía no puede existir en la mañana.
  const at = (now: string, scan: string) => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    const ship = mkShip({ subId: 's44', trackingNumber: 'A' });
    ship.statusHistory = [{ exceptionCode: '44', timestamp: new Date(scan) }];
    return svcWith([SUB44], [ship]).getMissingScanReportMulti(['s44']);
  };
  afterEach(() => jest.useRealTimers());

  it('escaneada anoche (08-oct 21:36) y hoy 09-oct en la mañana → al día (0)', async () => {
    const { details } = await at('2026-10-09T16:00:00Z', '2026-10-09T04:36:00Z');
    expect(details[0].daysSinceLastCode).toBe(0);
    expect(details[0].category).toBe('hoy');
  });

  it('último escaneo antenoche (07-oct) → 1 día sin código (le faltó el 08-oct)', async () => {
    const { details } = await at('2026-10-09T16:00:00Z', '2026-10-08T04:58:00Z');
    expect(details[0].daysSinceLastCode).toBe(1);
    expect(details[0].category).toBe('sinCodigo');
  });

  it('escaneada hoy en la noche → al día (0)', async () => {
    const { details } = await at('2026-10-10T05:30:00Z', '2026-10-10T04:36:00Z');
    expect(details[0].daysSinceLastCode).toBe(0);
  });

  it('candado temporal: consulta SOLO FedEx dados de alta en octubre 2026 (paquetes y cargas)', async () => {
    const svc = svcWith([SUB44], []);
    const { period } = await svc.getMissingScanReportMulti(['s44']);
    for (const repo of [svc.shipmentRepository, svc.chargeShipmentRepository]) {
      const { where } = repo.find.mock.calls[0][0];
      expect(where.shipmentType).toBe('fedex');
      expect(where.createdAt).toEqual(Between(MISSING_SCAN_REPORT_WINDOW.from, MISSING_SCAN_REPORT_WINDOW.to));
    }
    expect(period).toEqual({ from: '2026-10-01T07:00:00.000Z', to: '2026-11-01T06:59:59.999Z' });
  });
});
