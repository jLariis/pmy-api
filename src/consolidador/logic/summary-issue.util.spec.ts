import { buildTopIssue } from './summary-issue.util';

const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const base = {
  incomeTotal: 1000, packages: 10, charges: 1,
  missing: { count: 0, amount: 0 }, extra: { count: 0, amount: 0 }, doubles: 0,
  collections: { registered: 5, charged: 5, withoutCharge: 0 }, novan: { total: 2, charged: 2, withoutCharge: 0 },
  lastManualCount: null as null | { differences: number; createdAt: string; scope: 'day' | 'week' },
};

describe('buildTopIssue', () => {
  it('falta cobrar más caro que lo de más → bad', () => {
    expect(buildTopIssue({ ...base, missing: { count: 32, amount: 3904 }, extra: { count: 30, amount: 3660 } }, money))
      .toEqual({ topIssue: '32 guías faltan por cobrar ($3,904)', level: 'bad' });
  });
  it('lo de más más caro → bad con el cobro de más', () => {
    expect(buildTopIssue({ ...base, missing: { count: 1, amount: 122 }, extra: { count: 30, amount: 3660 } }, money))
      .toEqual({ topIssue: '30 guías cobradas de más ($3,660)', level: 'bad' });
  });
  it('dobles con cobro, sin más → se nombran como paquete y carga', () => {
    expect(buildTopIssue({ ...base, doubles: 23, extra: { count: 23, amount: 2806 } }, money))
      .toEqual({ topIssue: '23 guías cobradas como paquete y como carga ($2,806)', level: 'bad' });
  });
  it('solo recolecciones sin cobro → warn', () => {
    expect(buildTopIssue({ ...base, collections: { registered: 33, charged: 31, withoutCharge: 2 }, lastManualCount: { differences: 0, createdAt: 'x', scope: 'day' } }, money))
      .toEqual({ topIssue: '2 recolecciones sin cobro', level: 'warn' });
  });
  it('todo en cero sin conteo → none', () => {
    expect(buildTopIssue(base, money)).toEqual({ topIssue: 'Falta pegar el conteo manual', level: 'none' });
  });
  it('todo en cero con conteo sin diferencias → ok', () => {
    expect(buildTopIssue({ ...base, lastManualCount: { differences: 0, createdAt: 'x', scope: 'day' } }, money))
      .toEqual({ topIssue: 'Nada pendiente', level: 'ok' });
  });
  it('conteo con diferencias y sin otros problemas → warn', () => {
    expect(buildTopIssue({ ...base, lastManualCount: { differences: 3, createdAt: 'x', scope: 'day' } }, money))
      .toEqual({ topIssue: '3 diferencias en el último conteo manual', level: 'warn' });
  });
  it('una sola guía en singular', () => {
    expect(buildTopIssue({ ...base, missing: { count: 1, amount: 122 } }, money).topIssue).toBe('1 guía falta por cobrar ($122)');
  });
});
