import { prioritizeTrackables, tierOf } from './prioritize.util';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

const item = (id: string, status: ShipmentStatusType) => ({ kind: 'shipment' as const, entity: { id, trackingNumber: id, status } as any });

describe('cadence prioritize', () => {
  it('tierOf clasifica caliente vs tibia', () => {
    expect(tierOf(ShipmentStatusType.EN_RUTA)).toBe('hot');
    expect(tierOf(ShipmentStatusType.ACARGO_DE_FEDEX)).toBe('hot');
    expect(tierOf(ShipmentStatusType.PENDIENTE)).toBe('warm');
    expect(tierOf(ShipmentStatusType.EN_BODEGA)).toBe('warm');
  });

  it('ordena calientes primero, estable dentro de cada tier', () => {
    const items = [
      item('a', ShipmentStatusType.PENDIENTE),
      item('b', ShipmentStatusType.EN_RUTA),
      item('c', ShipmentStatusType.EN_BODEGA),
      item('d', ShipmentStatusType.ACARGO_DE_FEDEX),
    ];
    const out = prioritizeTrackables(items).map((i) => i.entity.id);
    expect(out).toEqual(['b', 'd', 'a', 'c']); // hot(b,d) preservando orden, luego warm(a,c)
  });

  it('cap recorta al máximo indicado (para el cron persistente)', () => {
    const items = [
      item('a', ShipmentStatusType.PENDIENTE),
      item('b', ShipmentStatusType.EN_RUTA),
      item('c', ShipmentStatusType.EN_RUTA),
    ];
    const out = prioritizeTrackables(items, { cap: 2 }).map((i) => i.entity.id);
    expect(out).toEqual(['b', 'c']); // los 2 calientes; la tibia queda fuera
  });

  it('sin cap devuelve todo (cobertura completa para shadow)', () => {
    const items = [item('a', ShipmentStatusType.PENDIENTE), item('b', ShipmentStatusType.EN_RUTA)];
    expect(prioritizeTrackables(items)).toHaveLength(2);
  });
});
