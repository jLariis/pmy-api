import { pickShipmentRowForDay } from './manual-count-facts.util';

const row = (id: string, consDay: string | null, over: Partial<{ subsidiaryId: string; kind: 'shipment' | 'charge' }> = {}) => ({
  id, consDay, createdAt: `${consDay ?? '2026-09-01'}T15:00:00Z`, subsidiaryId: 'cabo', kind: 'shipment' as const, ...over,
});

describe('pickShipmentRowForDay', () => {
  it('guía reingresada: toma la fila vigente ese día, no la más reciente (383571875104)', () => {
    const rows = [row('vieja', '2026-09-11'), row('nueva', '2026-09-19')];
    expect(pickShipmentRowForDay(rows, 'cabo', '2026-09-14')?.id).toBe('vieja');
    expect(pickShipmentRowForDay(rows, 'cabo', '2026-09-20')?.id).toBe('nueva');
  });

  it('si todas son posteriores al día, toma la más antigua', () => {
    expect(pickShipmentRowForDay([row('b', '2026-09-19'), row('a', '2026-09-18')], 'cabo', '2026-09-14')?.id).toBe('a');
  });

  it('prefiere la fila de la sucursal consultada', () => {
    const rows = [row('otra', '2026-09-12', { subsidiaryId: 'hmo' }), row('mia', '2026-09-10')];
    expect(pickShipmentRowForDay(rows, 'cabo', '2026-09-14')?.id).toBe('mia');
  });

  it('prefiere envío sobre carga F2', () => {
    const rows = [row('carga', '2026-09-12', { kind: 'charge' }), row('envio', '2026-09-10')];
    expect(pickShipmentRowForDay(rows, 'cabo', '2026-09-14')?.id).toBe('envio');
  });

  it('sin filas → null', () => {
    expect(pickShipmentRowForDay([], 'cabo', '2026-09-14')).toBeNull();
  });
});
