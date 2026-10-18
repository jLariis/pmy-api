import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { DevolutionRecord, isInOpenRoute, recordsToMark, suggestDevolutionRecord } from './devolution-target.util';

const rec = (over: Partial<DevolutionRecord>): DevolutionRecord => ({
  kind: 'shipment',
  id: 'x',
  createdAt: new Date('2026-10-15T19:00:00Z'),
  status: ShipmentStatusType.PENDIENTE,
  consolidatedId: null,
  consNumber: null,
  consDate: null,
  subsidiaryId: null,
  subsidiaryName: null,
  lastRoute: null,
  entregadoIncome: null,
  ...over,
});

// Caso 384096861505: registro del 15 (DEX17, ruta cerrada) y del 16 (en ruta abierta).
const del15 = rec({
  id: 'A',
  createdAt: new Date('2026-10-15T19:28:41Z'),
  status: ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
  lastRoute: { folio: '928034172792', routeDate: '2026-10-15', closed: true },
});
const del16 = rec({
  id: 'B',
  createdAt: new Date('2026-10-16T19:52:54Z'),
  status: ShipmentStatusType.EN_RUTA,
  lastRoute: { folio: '805022196741', routeDate: '2026-10-16', closed: false },
});

describe('devolution-target', () => {
  it('va en ruta solo si está EN_RUTA en una salida sin cerrar', () => {
    expect(isInOpenRoute(del16)).toBe(true);
    expect(isInOpenRoute(del15)).toBe(false);
    expect(isInOpenRoute({ ...del16, lastRoute: { ...del16.lastRoute!, closed: true } })).toBe(false);
  });

  it('caso 384096861505: sugiere el del 15, no el del 16 que va en ruta', () => {
    expect(suggestDevolutionRecord([del16, del15])?.id).toBe('A');
  });

  it('sin rutas abiertas sugiere el más nuevo sin desenlace final', () => {
    const entregado = rec({ id: 'N', createdAt: new Date('2026-10-17T00:00:00Z'), status: ShipmentStatusType.ENTREGADO });
    expect(suggestDevolutionRecord([del15, entregado])?.id).toBe('A');
  });

  it('si todos van en ruta, sugiere el más nuevo', () => {
    const otro = { ...del16, id: 'C', createdAt: new Date('2026-10-14T00:00:00Z') };
    expect(suggestDevolutionRecord([otro, del16])?.id).toBe('B');
  });

  it('sin registros no sugiere nada', () => {
    expect(suggestDevolutionRecord([])).toBeNull();
  });

  it('marca el elegido y los más viejos abiertos, nunca uno más nuevo', () => {
    const viejo = rec({ id: 'V', createdAt: new Date('2026-10-10T00:00:00Z'), status: ShipmentStatusType.EN_BODEGA });
    expect(recordsToMark([viejo, del15, del16], del15).map((r) => r.id)).toEqual(['A', 'V']);
  });

  it('no vuelve a marcar uno que ya tiene desenlace final', () => {
    const entregadoViejo = rec({ id: 'E', createdAt: new Date('2026-10-01T00:00:00Z'), status: ShipmentStatusType.ENTREGADO });
    expect(recordsToMark([entregadoViejo, del15], del15).map((r) => r.id)).toEqual(['A']);
  });
});
