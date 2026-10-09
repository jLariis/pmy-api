import { collectionDayOf, diagnoseCollection, pickedUpDayOf, summarizeCollections } from './manual-count-collection.util';
import { CollectionFacts } from './manual-count.types';

const SUB = 'sub-1';
const DAY = '2026-10-08';
const ctx = { day: DAY, subsidiaryId: SUB, expectedCost: 59 };

const facts = (over: Partial<CollectionFacts> = {}): CollectionFacts => ({
  trackingNumber: '877584205176',
  registrations: [{ subsidiaryId: SUB, day: DAY }],
  is315: false,
  incomes: [{ id: 'i1', day: DAY, cost: 59, active: true }],
  fedex: { ok: true, pickedUpDay: DAY },
  ...over,
});

describe('diagnoseCollection', () => {
  it('contada, registrada ese día, FedEx la recolectó y cobrada bien → cuadra', () => {
    const r = diagnoseCollection(true, facts(), ctx);
    expect(r.verdict).toBe('CUADRA');
    expect(r.cause).toBeNull();
    expect(r.incomeIds).toEqual(['i1']);
  });

  it('contada pero no registrada; FedEx sí la recolectó ese día → error del sistema', () => {
    const r = diagnoseCollection(true, facts({ registrations: [], incomes: [] }), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'REC_NO_EXISTE' });
  });

  it('contada, no registrada y FedEx tampoco la recolectó → error de conteo', () => {
    const r = diagnoseCollection(true, facts({ registrations: [], incomes: [], fedex: { ok: true, pickedUpDay: null } }), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_CONTEO', cause: 'REC_NO_EXISTE' });
  });

  it('registrada en otra sucursal → error del sistema', () => {
    const r = diagnoseCollection(true, facts({ registrations: [{ subsidiaryId: 'otra', day: DAY }] }), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'REC_OTRA_SUCURSAL' });
  });

  it('registrada otro día y FedEx la recolectó el día contado → error del sistema', () => {
    const r = diagnoseCollection(true, facts({ registrations: [{ subsidiaryId: SUB, day: '2026-10-09' }] }), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'REC_OTRO_DIA' });
  });

  it('registrada otro día y FedEx también dice ese otro día → error de conteo', () => {
    const r = diagnoseCollection(true, facts({
      registrations: [{ subsidiaryId: SUB, day: '2026-10-09' }], fedex: { ok: true, pickedUpDay: '2026-10-09' },
    }), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_CONTEO', cause: 'REC_OTRO_DIA' });
  });

  it('sin cobro activo → falta el cobro', () => {
    const r = diagnoseCollection(true, facts({ incomes: [{ id: 'i1', day: DAY, cost: 59, active: false }] }), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'REC_SIN_COBRO' });
  });

  it('dos cobros activos → duplicado', () => {
    const r = diagnoseCollection(true, facts({
      incomes: [{ id: 'i1', day: DAY, cost: 59, active: true }, { id: 'i2', day: DAY, cost: 59, active: true }],
    }), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'REC_DUPLICADO' });
  });

  it('monto distinto al costo de la sucursal', () => {
    const r = diagnoseCollection(true, facts({ incomes: [{ id: 'i1', day: DAY, cost: 0, active: true }] }), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'REC_MONTO' });
  });

  it('cobro en otro día', () => {
    const r = diagnoseCollection(true, facts({ incomes: [{ id: 'i1', day: '2026-10-07', cost: 59, active: true }] }), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'REC_COBRO_OTRO_DIA' });
  });

  it('ruta 31.5 sin cobro → regla (no cobra)', () => {
    const r = diagnoseCollection(true, facts({ is315: true, incomes: [] }), ctx);
    expect(r).toMatchObject({ verdict: 'REGLA', cause: 'REC_REGLA_315' });
  });

  it('ruta 31.5 con cobro → cobro de más', () => {
    const r = diagnoseCollection(true, facts({ is315: true }), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'REC_COBRO_315' });
  });

  it('en el sistema ese día pero no contada → falta en el conteo', () => {
    const r = diagnoseCollection(false, facts(), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_CONTEO', cause: 'REC_FALTA_CONTEO', counted: false });
  });

  it('ruta 31.5 sin cobro y no contada → falta en el conteo (no "regla")', () => {
    const r = diagnoseCollection(false, facts({ is315: true, incomes: [] }), ctx);
    expect(r).toMatchObject({ verdict: 'ERROR_CONTEO', cause: 'REC_FALTA_CONTEO' });
  });

  it('FedEx sin respuesta no rompe el diagnóstico (cuadra con lo del sistema)', () => {
    const r = diagnoseCollection(true, facts({ fedex: { ok: false, pickedUpDay: null } }), ctx);
    expect(r.verdict).toBe('CUADRA');
    expect(r.fedexLabel).toBe('FedEx no respondió');
  });
});

describe('collectionDayOf (revisión por semana)', () => {
  const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
  it('usa el día registrado en la sucursal si cae en la semana', () => {
    expect(collectionDayOf(facts({ registrations: [{ subsidiaryId: SUB, day: '2026-10-07' }] }), SUB, week)).toBe('2026-10-07');
  });
  it('si no está registrada usa el día de FedEx', () => {
    expect(collectionDayOf(facts({ registrations: [], fedex: { ok: true, pickedUpDay: '2026-10-06' } }), SUB, week)).toBe('2026-10-06');
  });
  it('sin pistas, el lunes', () => {
    expect(collectionDayOf(facts({ registrations: [], fedex: null }), SUB, week)).toBe('2026-10-05');
  });
});

describe('summarizeCollections', () => {
  it('cuenta contadas, recolectadas por FedEx y cobradas', () => {
    const rows = [
      diagnoseCollection(true, facts(), ctx),
      diagnoseCollection(false, facts({ trackingNumber: 'B', incomes: [] }), ctx),
    ];
    const t = summarizeCollections(rows);
    expect(t).toMatchObject({ manual: 1, fedex: 2, charged: 1 });
    expect(t.byVerdict.CUADRA).toBe(1);
    // Del sistema, sin contar y sin cobro: pesa el error del sistema (y lo dice en la explicación).
    expect(t.byVerdict.ERROR_SISTEMA).toBe(1);
    expect(rows[1].explanation).toContain('no viene en el conteo');
  });
});

describe('pickedUpDayOf', () => {
  const her = (d: Date) => new Date(d.getTime() - 7 * 3600e3).toISOString().slice(0, 10);
  // Caso real 878334111290: "Picked up" 07-oct 15:01 Hermosillo (22:01Z), luego viaja a Chihuahua.
  it('toma el primer "Picked up" en hora de Hermosillo', () => {
    const track = { scanEvents: [
      { eventType: 'OD', date: '2026-10-09T12:17:00-07:00' },
      { eventType: 'PU', date: '2026-10-07T15:01:00-07:00' },
      { eventType: 'OC', date: '2026-10-07T13:26:26-05:00' },
    ] };
    expect(pickedUpDayOf(track, her)).toBe('2026-10-07');
  });
  it('sin "Picked up" → null', () => {
    expect(pickedUpDayOf({ scanEvents: [{ eventType: 'OC', date: '2026-10-07T13:26:26-05:00' }] }, her)).toBeNull();
    expect(pickedUpDayOf(null, her)).toBeNull();
  });
});
