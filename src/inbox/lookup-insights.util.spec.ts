import { bucketOf, countBuckets, dexCode, GuideFacts, guideInsights } from './lookup-insights.util';

const base: GuideFacts = {
  status: 'en_bodega',
  unloaded: true,
  routed: false,
  closed: false,
  income: 0,
  devolved: false,
  commitDateTime: null,
  isHighValue: false,
  otherRecords: 0,
};
const NOW = new Date('2026-10-18T18:00:00Z');
const texts = (g: Partial<GuideFacts>) => guideInsights({ ...base, ...g }, NOW).map((i) => i.text);

describe('lookup-insights.util', () => {
  it('agrupa estatus', () => {
    expect(bucketOf('entregado_por_fedex')).toBe('entregado');
    expect(bucketOf('cliente_no_disponible')).toBe('dex');
    expect(bucketOf('retorno_abandono_fedex')).toBe('devuelto');
    expect(bucketOf('en_transito')).toBe('en_ruta');
    expect(bucketOf(null)).toBe('otro');
    expect(countBuckets(['entregado', 'rechazado', 'rechazado', null])).toMatchObject({ entregado: 1, dex: 2, otro: 1 });
  });

  it('código DEX: el del evento manda; si no, el del estatus', () => {
    expect(dexCode('cliente_no_disponible', '8')).toBe('DEX08');
    expect(dexCode('rechazado', null)).toBe('DEX07');
    expect(dexCode('entregado', '07')).toBeNull();
  });

  it('avisa lo que está fuera de orden', () => {
    expect(texts({ routed: true, unloaded: false, closed: true, status: 'en_ruta' })).toContain('Salió a ruta sin pasar por desembarque.');
    expect(texts({ unloaded: false })).toContain('Todavía no se desembarca.');
    expect(texts({})).toContain('Desembarcada, pero no ha salido a ruta.');
    expect(texts({ routed: true, closed: false, status: 'en_ruta' })).toContain('Está en una salida a ruta que no se ha cerrado.');
    expect(texts({ status: 'entregado', routed: true, closed: true, income: 0 })).toContain('Tiene estatus cobrable y no tiene ingreso registrado.');
    expect(texts({ status: 'entregado', routed: true, closed: true, income: null })).not.toContain('Tiene estatus cobrable y no tiene ingreso registrado.');
    expect(texts({ otherRecords: 1 })[0]).toMatch(/registrada 2 veces/);
  });

  it('vencimiento solo para guías que no han terminado', () => {
    expect(texts({ commitDateTime: new Date('2026-10-17T18:00:00Z') })).toContain('Ya venció y no se ha entregado.');
    expect(texts({ commitDateTime: new Date('2026-10-18T23:00:00Z') })).toContain('Vence hoy.');
    expect(texts({ status: 'entregado', routed: true, closed: true, income: 50, commitDateTime: new Date('2026-10-17T18:00:00Z') })).toEqual([]);
  });
});
