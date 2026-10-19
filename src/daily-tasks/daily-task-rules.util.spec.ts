import { doneToNotify, liveDays, mergeTaskRow, pieceKeyOf, refreshOnView, shouldAlertNew, stepAlertsEnabled, subsidiaryHasOperation } from './daily-task-rules.util';

describe('liveDays', () => {
  it('hoy y los 2 días anteriores, aunque crucen al domingo y sábado de la semana pasada', () => {
    expect(liveDays('2026-10-19')).toEqual(['2026-10-19', '2026-10-18', '2026-10-17']);
  });
});

describe('refreshOnView', () => {
  it('días de los últimos 7 se recalculan al abrirlos; más viejos se leen del historial', () => {
    expect(refreshOnView('2026-10-12', '2026-10-17')).toBe(true);
    expect(refreshOnView('2026-10-09', '2026-10-17')).toBe(false);
    expect(refreshOnView('2026-10-18', '2026-10-17')).toBe(false);
  });
});

describe('mergeTaskRow / doneToNotify', () => {
  it('una fila nueva nace con el estado ya avisado igual a su estado (no avisa lo que ya estaba)', () => {
    expect(mergeTaskRow(null, { status: 'done' } as any).notifiedStatus).toBe('done');
    expect(mergeTaskRow(null, { status: 'pending' } as any).notifiedStatus).toBe('pending');
  });
  it('al actualizar conserva el estado avisado aunque lo guarde la pantalla', () => {
    expect(mergeTaskRow({ id: 'x', status: 'partial', notifiedStatus: 'partial' } as any, { status: 'done' } as any)).toMatchObject({ id: 'x', status: 'done', notifiedStatus: 'partial' });
  });
  it('avisa "listo" solo de filas listas que no se habían avisado; done→partial→done no repite', () => {
    const rows = [
      { id: 'a', status: 'done', notifiedStatus: 'partial' },
      { id: 'b', status: 'done', notifiedStatus: 'done' },
      { id: 'c', status: 'partial', notifiedStatus: 'done' },
    ] as any[];
    expect(doneToNotify(rows).map((r) => r.id)).toEqual(['a']);
  });
});

describe('subsidiaryHasOperation', () => {
  const f = { dispatchesTotal: 0, inventoryInitialAt: null, inventoryFinalAt: null } as any;
  it('sin consolidados, rutas ni inventarios ese día → no hay tareas de sucursal', () => {
    expect(subsidiaryHasOperation(f, 0)).toBe(false);
  });
  it('con cualquier operación sí', () => {
    expect(subsidiaryHasOperation(f, 1)).toBe(true);
    expect(subsidiaryHasOperation({ ...f, dispatchesTotal: 2 }, 0)).toBe(true);
    expect(subsidiaryHasOperation({ ...f, inventoryInitialAt: new Date() }, 0)).toBe(true);
  });
});

describe('stepAlertsEnabled', () => {
  it('el interruptor de la sucursal apaga solo los avisos de ese paso', () => {
    expect(stepAlertsEnabled({ stepClosure: false } as any, 'closure')).toBe(false);
    expect(stepAlertsEnabled({ stepClosure: false } as any, 'dispatch')).toBe(true);
    expect(stepAlertsEnabled(null, 'inventory_final')).toBe(true);
    expect(stepAlertsEnabled({ stepInventory: false } as any, 'inventory_final')).toBe(false);
  });
});

describe('shouldAlertNew', () => {
  const boot = new Date('2026-10-17T13:00:00Z');
  it('lo que ya venía atrasado antes de arrancar el servidor se registra sin avisar', () => {
    expect(shouldAlertNew('2026-10-17', '2026-10-17', new Date('2026-10-17T12:00:00Z'), boot)).toBe(false);
  });
  it('días anteriores nunca avisan al registrarse', () => {
    expect(shouldAlertNew('2026-10-16', '2026-10-17', new Date('2026-10-17T14:00:00Z'), boot)).toBe(false);
  });
  it('atraso de hoy ocurrido con el servidor arriba sí avisa', () => {
    expect(shouldAlertNew('2026-10-17', '2026-10-17', new Date('2026-10-17T14:00:00Z'), boot)).toBe(true);
  });
});

describe('pieceKeyOf', () => {
  it('DHL cuenta por pieza (dhlUniqueId); FedEx por guía', () => {
    expect(pieceKeyOf({ trackingNumber: '1234567890', dhlUniqueId: 'JD0001' })).toBe('JD0001');
    expect(pieceKeyOf({ trackingNumber: '7781', dhlUniqueId: null })).toBe('7781');
  });
});

describe('summarizeToday', () => {
  const { summarizeToday } = require('./daily-task-rules.util');
  const r = (o: any) => ({ refType: 'consolidated', refId: 'c', consNumber: '7781', step: 'dispatch', status: 'pending', dueAt: new Date('2026-10-18T17:00:00Z'), ...o });
  it('cuenta atrasados, pendientes y listos; lista los atrasados por hora de vencimiento', () => {
    const s = summarizeToday([
      r({ status: 'late', step: 'closure', dueAt: new Date('2026-10-18T04:00:00Z') }),
      r({ status: 'late', step: 'unloading', dueAt: new Date('2026-10-18T03:00:00Z') }),
      r({ status: 'partial' }),
      r({ status: 'pending' }),
      r({ status: 'done' }),
    ]);
    expect(s).toMatchObject({ late: 2, pending: 2, done: 1, total: 5 });
    expect(s.lateItems.map((x: any) => x.step)).toEqual(['unloading', 'closure']);
  });
  it('máximo 5 atrasados en la lista', () => {
    expect(summarizeToday(Array.from({ length: 8 }, () => r({ status: 'late' }))).lateItems).toHaveLength(5);
  });
});
