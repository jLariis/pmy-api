import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { orderByActiveGeneration, pickActiveGeneration, trackingRefFor } from './fedex-generation.util';

const gen = (uid: string, dates: string[], extra: Record<string, any> = {}) => ({
  trackingNumberInfo: { trackingNumber: '522209574500', trackingNumberUniqueId: uid, carrierCode: 'FDXE' },
  scanEvents: dates.map((date) => ({ date })),
  ...extra,
});

describe('pickActiveGeneration — el envío con el escaneo más reciente', () => {
  it('dos etiquetas activas (522209574500): gana la que se movió aunque tenga secuencia menor', () => {
    const stale = gen('2461329000~522209574500~FX', ['2026-10-20T09:25:00-07:00', '2026-10-17T17:14:00-07:00']);
    const active = gen('2461327000~522209574500~FX', ['2026-10-21T14:10:00-07:00', '2026-10-20T18:23:00-07:00']);
    expect(pickActiveGeneration([stale, active])).toBe(active);
  });

  it('guía reciclada: la generación nueva tiene los escaneos recientes y gana', () => {
    const old = gen('2461000000~1~FX', ['2026-05-02T10:00:00-07:00']);
    const recycled = gen('2461300000~1~FX', ['2026-10-20T09:00:00-07:00']);
    expect(pickActiveGeneration([old, recycled])).toBe(recycled);
  });

  it('no depende del orden de scanEvents (toma el más reciente de todos)', () => {
    const a = gen('2461000000~1~FX', ['2026-10-01T10:00:00-07:00', '2026-10-22T10:00:00-07:00']);
    const b = gen('2461300000~1~FX', ['2026-10-21T10:00:00-07:00']);
    expect(pickActiveGeneration([b, a])).toBe(a);
  });

  it('empate de fecha → secuencia más alta', () => {
    const a = gen('2461000000~1~FX', ['2026-10-20T10:00:00-07:00']);
    const b = gen('2461300000~1~FX', ['2026-10-20T10:00:00-07:00']);
    expect(pickActiveGeneration([a, b])).toBe(b);
  });

  it('un resultado con error (sin escaneos) no gana a uno con datos', () => {
    const err = gen('2461900000~1~FX', [], { error: { code: 'TRACKING.TRACKINGNUMBER.NOTFOUND' } });
    const ok = gen('2461300000~1~FX', ['2026-10-20T10:00:00-07:00']);
    expect(pickActiveGeneration([err, ok])).toBe(ok);
  });

  it('vacío → null; uno solo → ese', () => {
    expect(pickActiveGeneration([])).toBeNull();
    const one = gen('1~1~FX', []);
    expect(pickActiveGeneration([one])).toBe(one);
  });

  it('orderByActiveGeneration deja el ganador primero y no muta el arreglo', () => {
    const stale = gen('2461329000~x~FX', ['2026-10-20T09:25:00-07:00']);
    const active = gen('2461327000~x~FX', ['2026-10-21T14:10:00-07:00']);
    const input = [stale, active];
    expect(orderByActiveGeneration(input)[0]).toBe(active);
    expect(input[0]).toBe(stale);
  });
});

describe('trackingRefFor — solo se amarra al envío guardado cuando la guía ya está cerrada', () => {
  const base = { trackingNumber: '522209574500', fedexUniqueId: '2461329000~522209574500~FX', carrierCode: 'FDXE' };

  it('guía abierta → consulta por número (sin uniqueId ni carrierCode)', () => {
    expect(trackingRefFor({ ...base, status: ShipmentStatusType.EN_RUTA })).toEqual({ trackingNumber: '522209574500' });
  });

  it('guía cerrada (entregada / devuelta) → amarrada a su envío', () => {
    expect(trackingRefFor({ ...base, status: ShipmentStatusType.ENTREGADO })).toEqual(base);
    expect(trackingRefFor({ ...base, status: ShipmentStatusType.DEVUELTO_A_FEDEX })).toEqual(base);
  });

  it('sin estatus conocido → se comporta como abierta', () => {
    expect(trackingRefFor(base)).toEqual({ trackingNumber: '522209574500' });
  });
});
