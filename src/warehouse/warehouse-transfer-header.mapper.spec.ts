// src/warehouse/warehouse-transfer-header.mapper.spec.ts
import { buildTransferNotificationHeader } from './warehouse.service';

describe('buildTransferNotificationHeader', () => {
  it('incluye vehículo, choferes, rutas, folio y título con destino', () => {
    const outbound: any = {
      warehouse: { id: 'w1', name: 'Bodega Hermosillo' },
      vehicle: { name: 'ECON-07' },
      drivers: [{ name: 'Juan' }, { name: 'Pedro' }],
      routes: [{ name: 'R1' }],
      trackingNumber: '1234567890',
    };
    const h = buildTransferNotificationHeader(outbound, 'Cd. Obregón');
    expect(h.subsidiary).toEqual({ id: 'w1', name: 'Bodega Hermosillo' });
    expect(h.vehicle).toEqual({ name: 'ECON-07' });
    expect(h.drivers).toEqual([{ name: 'Juan' }, { name: 'Pedro' }]);
    expect(h.routes).toEqual([{ name: 'R1' }]);
    expect(h.trackingNumber).toBe('1234567890');
    expect(h.title).toBe('TRASPASO → Cd. Obregón');
  });

  it('destino faltante -> N/D en el título; folio/relaciones caen a defaults seguros', () => {
    const h = buildTransferNotificationHeader(
      { warehouse: { id: 'w1', name: 'Bodega Hermosillo' } } as any,
      null,
    );
    expect(h.title).toBe('TRASPASO → N/D');
    expect(h.trackingNumber).toBe('');
    expect(h.vehicle ?? null).toBeNull();
  });

  it('outbound nulo no revienta', () => {
    const h = buildTransferNotificationHeader(null, 'Cd. Obregón');
    expect(h.title).toBe('TRASPASO → Cd. Obregón');
    expect(h.subsidiary ?? null).toBeNull();
    expect(h.trackingNumber).toBe('');
  });
});
