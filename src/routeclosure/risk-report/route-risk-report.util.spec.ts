import { buildRouteRiskReport, RiskRouteInput } from './route-risk-report.util';

const route = (over: Partial<RiskRouteInput> = {}): RiskRouteInput => ({
  folio: '929567984667',
  subsidiaryName: 'Via Larga',
  drivers: 'Juan Pérez',
  total: 60,
  is315: false,
  closed: false,
  untilNextDispatch: true,
  withoutOutcome: [],
  packages: [],
  error: null,
  ...over,
});

const pkg = (trackingNumber: string, problems: string[], explanation = ['FedEx reporta ENTREGADO.']) => ({
  trackingNumber,
  kind: 'charge' as const,
  problems: problems as any,
  currentStatus: 'en_ruta',
  targetStatus: 'entregado',
  explanation,
});

describe('buildRouteRiskReport', () => {
  it('ordena primero las rutas con guías por corregir y cuenta totales', () => {
    const r = buildRouteRiskReport('2026-10-08', [
      route({ folio: 'A', subsidiaryName: 'Caborca' }),
      route({ folio: 'B', subsidiaryName: 'Navojoa', packages: [pkg('111', ['STATUS_BEHIND']), pkg('222', ['WARNING'])] }),
    ], 'https://app.test');
    expect(r.totals).toMatchObject({ routes: 2, routesWithIssues: 1, toFix: 2 });
    expect(r.html.indexOf('Navojoa')).toBeLessThan(r.html.indexOf('Caborca'));
    expect(r.subject).toContain('1 de 2 rutas');
    expect(r.html).toContain('https://app.test/operaciones/salidas-a-ruta?seguimiento=B');
  });

  it('"entregado antes de la ruta" solo informativo no cuenta como por corregir', () => {
    const r = buildRouteRiskReport('2026-10-08', [route({ packages: [pkg('111', ['DELIVERED_BEFORE_ROUTE'])] })], 'x');
    expect(r.totals.toFix).toBe(0);
    expect(r.totals.routesWithIssues).toBe(0);
  });

  it('guías sin resultado en sucursal SIN la opción del día siguiente → aviso de riesgo', () => {
    const r = buildRouteRiskReport('2026-10-08', [
      route({ subsidiaryName: 'Navojoa', untilNextDispatch: false, withoutOutcome: ['333', '444'] }),
    ], 'x');
    expect(r.totals.withoutOutcome).toBe(2);
    expect(r.totals.routesWithIssues).toBe(1);
    expect(r.html).toContain('333');
    expect(r.html).toContain('se quedarán');
  });

  it('sin resultado en sucursal CON la opción → solo se cuenta, no es riesgo', () => {
    const r = buildRouteRiskReport('2026-10-08', [route({ withoutOutcome: ['333'] })], 'x');
    expect(r.totals.withoutOutcome).toBe(1);
    expect(r.totals.routesWithIssues).toBe(0);
  });

  it('escapa HTML de los textos', () => {
    const r = buildRouteRiskReport('2026-10-08', [route({ subsidiaryName: '<b>X</b>', packages: [pkg('1', ['WARNING'], ['a < b'])] })], 'x');
    expect(r.html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(r.html).toContain('a &lt; b');
  });

  it('error al revisar una ruta se reporta sin tumbar el resto', () => {
    const r = buildRouteRiskReport('2026-10-08', [route({ error: 'FedEx no respondió' })], 'x');
    expect(r.totals.routesWithIssues).toBe(1);
    expect(r.html).toContain('FedEx no respondió');
  });

  it('sin rutas → asunto claro', () => {
    const r = buildRouteRiskReport('2026-10-08', [], 'x');
    expect(r.subject).toContain('sin salidas a ruta');
  });
});
