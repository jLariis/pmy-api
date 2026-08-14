import { InventoriesService } from './inventories.service';

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
  });

  it('multi-sucursal: cada fila usa el código de SU sucursal', async () => {
    const svc = svcWith(
      [SUB44, SUB67],
      [
        mkShip({ subId: 's44', trackingNumber: 'A', exceptionCode: '44' }), // hoy (44)
        mkShip({ subId: 's67', trackingNumber: 'B', exceptionCode: '44' }), // nunca (67-branch, 44 no cuenta)
      ],
    );
    const { details } = await svc.getMissingScanReportMulti(['s44', 's67']);
    const byTn = Object.fromEntries(details.map((d: any) => [d.trackingNumber, d]));
    expect(byTn.A.category).toBe('hoy');
    expect(byTn.B.category).toBe('nunca');
  });

  it('lista TODOS los activos sin filtrar por fecha (paquete viejo sí aparece)', async () => {
    const svc = svcWith([SUB44], [mkShip({ subId: 's44', trackingNumber: 'OLD', exceptionCode: null, createdAt: new Date('2026-02-01T00:00:00Z') })]);
    const { details } = await svc.getMissingScanReportMulti(['s44']);
    expect(details).toHaveLength(1);
    expect(details[0].trackingNumber).toBe('OLD');
  });
});
