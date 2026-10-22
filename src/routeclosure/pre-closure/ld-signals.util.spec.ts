import { buildLdSignals } from './ld-signals.util';

const ROUTE_DAY = '2026-10-20';
// 2026-10-20 12:00 Hermosillo = 19:00Z
const DUE_TODAY = '2026-10-20T19:00:00.000Z';
const base = { status: 'en_ruta', commitDateTime: DUE_TODAY, routeDay: ROUTE_DAY, eventDays: new Set<string>(), dexDays: new Set<string>() };

describe('buildLdSignals', () => {
  it('en ruta, vence hoy y sin eventos → sin movimiento + vence hoy + posible LD', () => {
    expect(buildLdSignals(base)).toEqual({ noMovement: true, dueToday: true, ldState: 'possible_ld' });
  });

  it('DEX válido el día de vencimiento → quita el riesgo', () => {
    const r = buildLdSignals({ ...base, status: 'cliente_no_disponible', eventDays: new Set([ROUTE_DAY]), dexDays: new Set([ROUTE_DAY]) });
    expect(r).toEqual({ noMovement: false, dueToday: true, ldState: 'active' });
  });

  it('vencido ayer sin DEX → LD', () => {
    const r = buildLdSignals({ ...base, commitDateTime: '2026-10-19T19:00:00.000Z' });
    expect(r.dueToday).toBe(false);
    expect(r.ldState).toBe('ld');
  });

  it('entregado → sin señales', () => {
    const r = buildLdSignals({ ...base, status: 'entregado' });
    expect(r).toEqual({ noMovement: false, dueToday: true, ldState: 'delivered' });
  });

  it('no commit date → sin vence hoy ni LD, sin error', () => {
    const r = buildLdSignals({ ...base, commitDateTime: null });
    expect(r).toEqual({ noMovement: true, dueToday: false, ldState: 'active' });
  });

  it('vence mañana → no es riesgo de LD', () => {
    const r = buildLdSignals({ ...base, commitDateTime: '2026-10-21T19:00:00.000Z' });
    expect(r.dueToday).toBe(false);
    expect(r.ldState).toBe('active');
  });

  it('usa el día de Hermosillo: 2026-10-21T06:30Z cae el 20', () => {
    const r = buildLdSignals({ ...base, commitDateTime: '2026-10-21T06:30:00.000Z' });
    expect(r.dueToday).toBe(true);
  });

  it('con movimiento en el día de la ruta pero sin DEX → sigue en posible LD (variante Salidas a ruta)', () => {
    const r = buildLdSignals({ ...base, eventDays: new Set([ROUTE_DAY]) });
    expect(r).toEqual({ noMovement: false, dueToday: true, ldState: 'possible_ld' });
  });
});
