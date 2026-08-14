import { KpiService } from './kpi.service';

/**
 * Welcome dashboard — sección "Sin escaneo local" debe usar el código que MONITOREA cada sucursal:
 * 67 por default, 44 si `monitorFedexCode44`. Antes hardcodeaba '67' y "Código 67".
 */
describe('KpiService.getWelcomeDashboard — código de escaneo por sucursal', () => {
  const sub67 = { id: 's67', name: 'Peñasco', monitorFedexCode44: false };
  const sub44 = { id: 's44', name: 'Hermosillo', monitorFedexCode44: true };

  const mkShip = (id: string, subsidiary: any, code: string | null) => ({
    id, trackingNumber: id, recipientName: 'X', shipmentType: 'fedex', subsidiary,
    statusHistory: code ? [{ exceptionCode: code }] : [],
  });

  function svcWith(scanShipments: any[]) {
    const svc = Object.create(KpiService.prototype) as any;
    svc.shipmentRepository = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]), // secciones vencen/pendientes vacías
      find: jest.fn().mockResolvedValue(scanShipments),   // sección "sin escaneo"
    };
    svc.chargeShipmentRepository = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      find: jest.fn().mockResolvedValue([]),
    };
    return svc;
  }

  it('sucursal 67: cuenta como "sin escaneo" solo si le falta el 67; etiqueta "Código 67"', async () => {
    const svc = svcWith([
      mkShip('con67', sub67, '67'),   // OK, no debe aparecer
      mkShip('sin67', sub67, null),   // sin 67 → aparece
      mkShip('solo44', sub67, '44'),  // tiene 44 pero es sucursal 67 → aparece
    ]);
    const { stats, withoutDEXPackages } = await svc.getWelcomeDashboard();
    expect(stats.withoutDEX).toBe(2);
    expect(withoutDEXPackages.every((p: any) => p.missingDocument === 'Código 67')).toBe(true);
    expect(withoutDEXPackages.map((p: any) => p.trackingNumber).sort()).toEqual(['sin67', 'solo44']);
  });

  it('sucursal 44: cuenta como "sin escaneo" solo si le falta el 44; etiqueta "Código 44"', async () => {
    const svc = svcWith([
      mkShip('con44', sub44, '44'),   // OK
      mkShip('solo67', sub44, '67'),  // tiene 67 pero es sucursal 44 → aparece
    ]);
    const { stats, withoutDEXPackages } = await svc.getWelcomeDashboard();
    expect(stats.withoutDEX).toBe(1);
    expect(withoutDEXPackages[0].trackingNumber).toBe('solo67');
    expect(withoutDEXPackages[0].missingDocument).toBe('Código 44');
  });
});
