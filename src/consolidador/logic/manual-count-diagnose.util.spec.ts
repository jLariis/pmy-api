import { diagnoseGuide, summarize } from './manual-count-diagnose.util';
import { DiagnoseContext, GuideFacts, IncomeRef, Mark } from './manual-count.types';

const DAY = '2026-09-22';
const SUB = 'hmo';

const ctx = (over: Partial<DiagnoseContext> = {}): DiagnoseContext => ({
  day: DAY,
  subsidiaryId: SUB,
  expectedCost: 52,
  isChargeable: () => true,
  ...over,
});

const income = (mark: Mark, over: Partial<IncomeRef> = {}): IncomeRef => ({
  id: `inc-${mark}`,
  mark,
  day: DAY,
  cost: 52,
  active: true,
  ...over,
});

/** Guía sana: consolidado, ruta del día cerrada, FedEx y sistema dicen `outcome`. */
const facts = (outcome: Mark | 'OTRO' | null, over: Partial<GuideFacts> = {}): GuideFacts => ({
  trackingNumber: 'TN',
  kind: 'shipment',
  subsidiaryId: SUB,
  transferredIn: false,
  consolidado: { consNumber: '220926365', day: DAY },
  routes: [{ dispatchId: 'd1', folio: 'R-1', routeDay: DAY, is315: false, closed: true }],
  systemStatus: 'entregado',
  systemOutcome: outcome,
  systemDex08Dates: [],
  fedex: { ok: true, outcome, outcomeAt: null, dex08Dates: [], lastCode: null },
  incomes: [],
  returned: false,
  warehouseDelivered: false,
  ...over,
});

const d08 = (...isos: string[]) => ({
  systemDex08Dates: isos,
  fedex: { ok: true, outcome: '08' as const, outcomeAt: null, dex08Dates: isos, lastCode: 'DE 08' },
});

describe('diagnoseGuide — casos reales Hermosillo 22-09', () => {
  it('540148275693: DEX08 con 1 visita cobrado → cobro de más', () => {
    const r = diagnoseGuide('08', facts('08', { trackingNumber: '540148275693', ...d08('2026-09-22T20:53:00Z'), incomes: [income('08')] }), ctx());
    expect(r).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'COBRO_DE_MAS', expected: null, charged: ['08'] });
    expect(r.subCause).toContain('1 visita');
  });

  it('877368113055: DEX08 con 2 visitas cobrado → cobro de más', () => {
    const r = diagnoseGuide('08', facts('08', { ...d08('2026-09-21T18:44:00Z', '2026-09-22T22:41:00Z'), incomes: [income('08')] }), ctx());
    expect(r).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'COBRO_DE_MAS' });
    expect(r.subCause).toContain('2 visitas');
  });
});

describe('diagnoseGuide — cuadra / conteo / regla', () => {
  it('POD bien cobrado → cuadra', () => {
    expect(diagnoseGuide('POD', facts('POD', { incomes: [income('POD')] }), ctx())).toMatchObject({ verdict: 'CUADRA', cause: null });
  });

  it('DEX08 en su 3er día de la semana y cobrado → cuadra', () => {
    const f = facts('08', { ...d08('2026-09-21T18:00:00Z', '2026-09-22T00:30:00Z', '2026-09-22T20:00:00Z', '2026-09-23T18:00:00Z'), incomes: [income('08', { day: '2026-09-23' })],
      routes: [{ dispatchId: 'd2', folio: 'R-2', routeDay: '2026-09-23', is315: false, closed: true }] });
    // 22-09 00:30Z = 21-09 local → días locales 21, 21, 22, 23 → el 3er día es el 23
    expect(diagnoseGuide('08', f, ctx({ day: '2026-09-23' }))).toMatchObject({ verdict: 'CUADRA', expected: '08' });
  });

  it('el usuario contó DEX08 pero FedEx y el sistema dicen POD → error de conteo', () => {
    expect(diagnoseGuide('08', facts('POD', { incomes: [income('POD')] }), ctx())).toMatchObject({ verdict: 'ERROR_CONTEO', cause: 'ERROR_CONTEO' });
  });

  it('el usuario no la contó pero sí cobra → error de conteo (no lo contaste)', () => {
    const r = diagnoseGuide(null, facts('POD', { incomes: [income('POD')] }), ctx());
    expect(r).toMatchObject({ verdict: 'ERROR_CONTEO', cause: 'ERROR_CONTEO' });
    expect(r.explanation).toContain('no');
  });

  it('DEX08 contado con 2 visitas y sin cobro → regla (todavía no cobra)', () => {
    const r = diagnoseGuide('08', facts('08', d08('2026-09-21T18:00:00Z', '2026-09-22T20:00:00Z')), ctx());
    expect(r).toMatchObject({ verdict: 'REGLA', cause: 'REGLA_NO_COBRA', expected: null });
  });

  it('entregado en bodega sin ruta → cuadra', () => {
    const f = facts('POD', { routes: [], warehouseDelivered: true, incomes: [income('POD')] });
    expect(diagnoseGuide('POD', f, ctx())).toMatchObject({ verdict: 'CUADRA' });
  });
});

describe('diagnoseGuide — cadena de validaciones', () => {
  it('no existe', () => {
    expect(diagnoseGuide('POD', facts(null, { kind: null, subsidiaryId: null, consolidado: null, routes: [], fedex: null }), ctx()))
      .toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'NO_EXISTE' });
  });

  it('es de otra sucursal', () => {
    expect(diagnoseGuide('POD', facts('POD', { subsidiaryId: 'otra' }), ctx())).toMatchObject({ cause: 'OTRA_SUCURSAL' });
  });

  it('de otra sucursal pero traspasada hacia la consultada → sigue la cadena', () => {
    expect(diagnoseGuide('POD', facts('POD', { subsidiaryId: 'otra', transferredIn: true, incomes: [income('POD')] }), ctx())).toMatchObject({ verdict: 'CUADRA' });
  });

  it('sin consolidado registrado', () => {
    expect(diagnoseGuide('POD', facts('POD', { consolidado: null }), ctx())).toMatchObject({ cause: 'SIN_CONSOLIDADO' });
  });

  it('consolidado registrado después del día', () => {
    expect(diagnoseGuide('POD', facts('POD', { consolidado: { consNumber: 'X', day: '2026-09-23' } }), ctx())).toMatchObject({ cause: 'SIN_CONSOLIDADO' });
  });

  it('nunca salió a ruta', () => {
    expect(diagnoseGuide('POD', facts('POD', { routes: [] }), ctx())).toMatchObject({ cause: 'SIN_RUTA' });
  });

  it('salió en una ruta de otro día', () => {
    const routes = [{ dispatchId: 'd0', folio: 'R-0', routeDay: '2026-09-21', is315: false, closed: true }];
    expect(diagnoseGuide('POD', facts('POD', { routes }), ctx())).toMatchObject({ cause: 'RUTA_OTRO_DIA' });
  });

  it('nuestro estatus no coincide con FedEx', () => {
    const f = facts('POD', { systemOutcome: '08', incomes: [income('POD')] });
    expect(diagnoseGuide('POD', f, ctx())).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'ESTATUS_DESFASADO' });
  });

  it('FedEx caído → usa el desenlace del sistema', () => {
    const f = facts('POD', { fedex: { ok: false, outcome: null, outcomeAt: null, dex08Dates: [], lastCode: null }, incomes: [income('POD')] });
    const r = diagnoseGuide('POD', f, ctx());
    expect(r).toMatchObject({ verdict: 'CUADRA', fedexSays: null });
    expect(r.chain.find((s) => s.step === 5)?.ok).toBeNull();
  });

  it('ruta 31.5 cobrada → cobro de más', () => {
    const routes = [{ dispatchId: 'd1', folio: 'R-1', routeDay: DAY, is315: true, closed: true }];
    const r = diagnoseGuide('POD', facts('POD', { routes, incomes: [income('POD')] }), ctx());
    expect(r).toMatchObject({ cause: 'COBRO_DE_MAS' });
    expect(r.subCause).toContain('31.5');
  });

  it('charge_rule de la sucursal no cobra el código → cobro de más', () => {
    const r = diagnoseGuide('07', facts('07', { incomes: [income('07')] }), ctx({ isChargeable: (c) => c !== '07' }));
    expect(r).toMatchObject({ cause: 'COBRO_DE_MAS' });
  });

  it('cobró con otro código', () => {
    const r = diagnoseGuide('POD', facts('POD', { incomes: [income('08')] }), ctx());
    expect(r).toMatchObject({ cause: 'COBRO_DE_MAS' });
    expect(r.subCause).toContain('DEX08');
  });

  it('POD sin ingreso con ruta cerrada → cobro faltante', () => {
    expect(diagnoseGuide('POD', facts('POD'), ctx())).toMatchObject({ verdict: 'ERROR_SISTEMA', cause: 'COBRO_FALTANTE', expected: 'POD' });
  });

  it('POD sin ingreso con ruta sin cerrar → cobro faltante (ruta sin cierre)', () => {
    const routes = [{ dispatchId: 'd1', folio: 'R-1', routeDay: DAY, is315: false, closed: false }];
    const r = diagnoseGuide('POD', facts('POD', { routes }), ctx());
    expect(r.cause).toBe('COBRO_FALTANTE');
    expect(r.subCause).toContain('cierre');
  });

  it('ingreso anulado → cobro faltante (anulado)', () => {
    const r = diagnoseGuide('POD', facts('POD', { incomes: [income('POD', { active: false })] }), ctx());
    expect(r.cause).toBe('COBRO_FALTANTE');
    expect(r.subCause).toContain('anul');
  });

  it('devolución anula el ingreso de entregado → no se espera cobro', () => {
    expect(diagnoseGuide('POD', facts('POD', { returned: true }), ctx())).toMatchObject({ expected: null });
  });

  it('ingreso registrado en otro día', () => {
    expect(diagnoseGuide('POD', facts('POD', { incomes: [income('POD', { day: '2026-09-23' })] }), ctx())).toMatchObject({ cause: 'INGRESO_OTRO_DIA' });
  });

  it('ingreso duplicado', () => {
    const f = facts('POD', { incomes: [income('POD'), income('POD', { id: 'inc-2' })] });
    expect(diagnoseGuide('POD', f, ctx())).toMatchObject({ cause: 'DUPLICADO' });
  });

  it('monto distinto al costo de la sucursal', () => {
    expect(diagnoseGuide('POD', facts('POD', { incomes: [income('POD', { cost: 40 })] }), ctx())).toMatchObject({ cause: 'MONTO_INCORRECTO' });
  });

  it('carga F2: cobro agrupado, solo compara el conteo', () => {
    expect(diagnoseGuide('POD', facts('POD', { kind: 'charge' }), ctx())).toMatchObject({ verdict: 'CUADRA' });
    expect(diagnoseGuide('08', facts('POD', { kind: 'charge' }), ctx())).toMatchObject({ verdict: 'ERROR_CONTEO', cause: 'F2_INFORMATIVO' });
  });

  it('la cadena siempre trae los 8 eslabones', () => {
    expect(diagnoseGuide('POD', facts('POD', { incomes: [income('POD')] }), ctx()).chain.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('summarize', () => {
  it('cuenta contado / FedEx / cobrado por Mark y por veredicto', () => {
    const rows = [
      diagnoseGuide('POD', facts('POD', { incomes: [income('POD')] }), ctx()),
      diagnoseGuide('08', facts('08', { ...d08('2026-09-22T20:53:00Z'), incomes: [income('08')] }), ctx()),
    ];
    const t = summarize(rows);
    expect(t.manual).toEqual({ POD: 1, '07': 0, '08': 1 });
    expect(t.fedex).toEqual({ POD: 1, '07': 0, '08': 1 });
    expect(t.charged).toEqual({ POD: 1, '07': 0, '08': 1 });
    expect(t.byVerdict).toEqual({ CUADRA: 1, ERROR_SISTEMA: 1, ERROR_CONTEO: 0, REGLA: 0 });
  });
});
