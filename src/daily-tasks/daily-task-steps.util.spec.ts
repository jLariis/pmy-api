import { consolidatedTasks, subsidiaryTasks } from './daily-task-steps.util';
import { ConsolidatedFacts, Schedule, SubsidiaryDayFacts, TaskRow } from './daily-task.types';

// Hermosillo = UTC-7: 08:00 local = 15:00Z.
const at = (day: string, hhmm: string) => new Date(Date.parse(`${day}T${hhmm}:00.000Z`) + 7 * 3600_000);
const D = '2026-10-17';
const S: Schedule = {
  uploadMinutes: 30, unloadingTime: '21:00', dispatchAfterUnloadMinutes: 120, dispatchNextDayTime: '10:00', closureTime: '21:00',
  inventoryInitialTime: '10:00', devolutionsTime: '19:30', inventoryFinalTime: '20:00', activeTo: '21:30', completePct: 100,
};
const p = (done: number, total: number, first: Date | null = null, last: Date | null = null) => ({ done, total, first, last });
const facts = (o: Partial<ConsolidatedFacts> = {}): ConsolidatedFacts => ({
  refType: 'consolidated', refId: 'c1', consNumber: '7781', day: D, carrier: 'fedex', type: 'ordinaria', guides: 124,
  uploadedAt: at(D, '06:40'), uploadedById: 'u1', uploadedByName: 'Ana', unloading: p(0, 124), dispatch: p(0, 0), closure: p(0, 0), ...o,
});
const step = (rows: TaskRow[], s: string) => rows.find((r) => r.step === s)!;

describe('consolidatedTasks', () => {
  it('consolidado subido queda listo con quién y a qué hora', () => {
    const r = step(consolidatedTasks(facts(), S, at(D, '07:00')), 'upload');
    expect(r).toMatchObject({ status: 'done', doneById: 'u1', doneByName: 'Ana' });
    expect(r.doneAt).toEqual(at(D, '06:40'));
  });

  it('desembarque 121/124 a las 15:00 → partial', () => {
    const r = step(consolidatedTasks(facts({ unloading: p(121, 124, at(D, '07:00'), at(D, '07:15')) }), S, at(D, '15:00')), 'unloading');
    expect(r).toMatchObject({ status: 'partial', doneCount: 121, totalCount: 124 });
  });

  it('desembarque 121/124 a las 21:05 → late', () => {
    expect(step(consolidatedTasks(facts({ unloading: p(121, 124) }), S, at(D, '21:05')), 'unloading').status).toBe('late');
  });

  it('desembarque 124/124 → done con la hora del último escaneo', () => {
    const r = step(consolidatedTasks(facts({ unloading: p(124, 124, at(D, '07:00'), at(D, '07:15')) }), S, at(D, '08:00')), 'unloading');
    expect(r.status).toBe('done');
    expect(r.doneAt).toEqual(at(D, '07:15'));
  });

  it('salida a ruta vence 2 h después del desembarque', () => {
    const r = step(consolidatedTasks(facts({ unloading: p(124, 124, at(D, '07:00'), at(D, '08:00')), dispatch: p(0, 124) }), S, at(D, '09:00')), 'dispatch');
    expect(r.dueAt).toEqual(at(D, '10:00'));
  });

  it('desembarque a las 20:30: la salida vence a las 10:00 del día siguiente, no a las 22:30', () => {
    const r = step(consolidatedTasks(facts({ unloading: p(124, 124, at(D, '20:00'), at(D, '20:30')), dispatch: p(0, 124) }), S, at(D, '21:00')), 'dispatch');
    expect(r.dueAt).toEqual(at('2026-10-18', '10:00'));
    expect(r.status).toBe('pending');
  });

  it('un paso no se vuelve late si el anterior no está listo', () => {
    const r = step(consolidatedTasks(facts({ unloading: p(100, 124), dispatch: p(0, 100) }), S, at('2026-10-19', '12:00')), 'dispatch');
    expect(r.status).toBe('pending');
  });

  it('cierre 1 de 3 rutas → partial; vence a la hora de cierre del día de la salida', () => {
    const r = step(
      consolidatedTasks(facts({ unloading: p(124, 124, at(D, '07:00'), at(D, '07:15')), dispatch: p(118, 118, at(D, '08:30'), at(D, '09:00')), closure: p(40, 118, at(D, '16:00'), at(D, '16:00')) }), S, at(D, '17:00')),
      'closure',
    );
    expect(r).toMatchObject({ status: 'partial', doneCount: 40, totalCount: 118 });
    expect(r.dueAt).toEqual(at(D, '21:00'));
  });

  it('las devoluciones no son paso: solo se informan (no todos los DEX regresan a FedEx)', () => {
    expect(consolidatedTasks(facts(), S, at(D, '23:00')).map((r) => r.step)).toEqual(['upload', 'unloading', 'dispatch', 'closure']);
    expect(subsidiaryTasks('s1', sub(), S, at(D, '23:00')).map((r) => r.step)).toEqual(['inventory_initial', 'closure', 'inventory_final']);
  });
});

const sub = (o: Partial<SubsidiaryDayFacts> = {}): SubsidiaryDayFacts => ({
  day: D, inventoryInitialAt: null, inventoryFinalAt: null, inventoryInitialBy: null, inventoryFinalBy: null,
  dispatchesTotal: 0, dispatchesClosed: 0, lastClosureAt: null, ...o,
});

describe('subsidiaryTasks', () => {
  it('sin inventario final a las 20:01 → late', () => {
    expect(step(subsidiaryTasks('s1', sub(), S, at(D, '20:01')), 'inventory_final').status).toBe('late');
  });

  it('inventario final hecho → done con hora', () => {
    const r = step(subsidiaryTasks('s1', sub({ inventoryFinalAt: at(D, '19:40'), inventoryFinalBy: 'Luis' }), S, at(D, '20:01')), 'inventory_final');
    expect(r).toMatchObject({ status: 'done', doneByName: 'Luis', refType: 'subsidiary', refId: 's1' });
  });

  it('4 de 6 rutas cerradas → closure partial', () => {
    expect(step(subsidiaryTasks('s1', sub({ dispatchesTotal: 6, dispatchesClosed: 4 }), S, at(D, '17:00')), 'closure')).toMatchObject({ status: 'partial', doneCount: 4, totalCount: 6 });
  });

  it('inventario inicial vence a las 10:00', () => {
    const r = step(subsidiaryTasks('s1', sub(), S, at(D, '10:01')), 'inventory_initial');
    expect(r.status).toBe('late');
    expect(r.dueAt).toEqual(at(D, '10:00'));
  });
});

describe('consolidatedTasks con totales en cero', () => {
  it('si no queda nada por sacar a ruta (todo terminó sin ruta), la salida y lo demás quedan listos', () => {
    const rows = consolidatedTasks(facts({ unloading: p(5, 5, at(D, '07:00'), at(D, '07:15')), dispatch: p(0, 0), closure: p(0, 0) }), S, at(D, '23:00'));
    expect(step(rows, 'dispatch').status).toBe('done');
    expect(step(rows, 'closure').status).toBe('done');
  });
  it('consolidado sin guías activas: desembarque listo', () => {
    expect(step(consolidatedTasks(facts({ unloading: p(0, 0) }), S, at(D, '23:00')), 'unloading').status).toBe('done');
  });
});

describe('total 0 solo cuenta como listo si el paso anterior terminó', () => {
  it('consolidado recién subido: salida y cierre NO aparecen listos', () => {
    const rows = consolidatedTasks(facts({ unloading: p(0, 124) }), S, at(D, '07:00'));
    expect(['dispatch', 'closure'].map((s) => step(rows, s).status)).toEqual(['pending', 'pending']);
  });
});
