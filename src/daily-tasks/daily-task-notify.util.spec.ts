import { alertRefKey, dayDigest, transitionMessage } from './daily-task-notify.util';
import { TaskRow } from './daily-task.types';

const at = (day: string, hhmm: string) => new Date(Date.parse(`${day}T${hhmm}:00.000Z`) + 7 * 3600_000);
const row = (o: Partial<TaskRow> = {}): TaskRow => ({
  refType: 'charge', refId: 'ch1', consNumber: '4410 0921', step: 'dispatch', status: 'late', doneCount: 0, totalCount: 38,
  dueAt: at('2026-10-17', '10:00'), doneAt: null, doneById: null, doneByName: null, ...o,
});
const t = (r: TaskRow, from: TaskRow['status'] | null) => ({ row: r, from, to: r.status, subsidiaryId: 's1', day: '2026-10-17' });

describe('transitionMessage', () => {
  it('pasa a tarde → tareas.paso_atrasado con texto en llano y liga a la pantalla', () => {
    const m = transitionMessage(t(row(), 'pending'), 'Hermosillo')!;
    expect(m.type).toBe('tareas.paso_atrasado');
    expect(m.title).toBe('F2 4410 0921 sin salida a ruta');
    expect(m.body).toBe('Hermosillo · venció a las 10:00');
    expect(m.link).toBe('/operaciones/tareas-del-dia?sucursal=s1&dia=2026-10-17');
  });

  it('partial → done → tareas.paso_completo', () => {
    const m = transitionMessage(t(row({ step: 'closure', status: 'done', refType: 'consolidated', consNumber: '7781 2034 5501', doneCount: 3, totalCount: 3 }), 'partial'), 'Hermosillo')!;
    expect(m.type).toBe('tareas.paso_completo');
    expect(m.title).toBe('Consolidado 7781 2034 5501: cierre de rutas listo');
  });

  it('tarea de sucursal: inventario final atrasado', () => {
    const m = transitionMessage(t(row({ refType: 'subsidiary', refId: 's1', consNumber: null, step: 'inventory_final', dueAt: at('2026-10-17', '20:00') }), 'pending'), 'Hermosillo')!;
    expect(m.title).toBe('Inventario final de día pendiente');
  });

  it('done → late o pending → partial no avisan', () => {
    expect(transitionMessage(t(row(), 'done'), 'H')).toBeNull();
    expect(transitionMessage(t(row({ status: 'partial' }), 'pending'), 'H')).toBeNull();
  });
});

describe('alertRefKey', () => {
  it('cabe en ops_alert.refKey (80) y distingue sucursal+día en tareas de sucursal', () => {
    const k = alertRefKey(t(row({ refType: 'subsidiary', refId: '040483fc-4322-4ce0-b124-cc5b6d2a9cee', step: 'inventory_initial' }), null));
    expect(k).toBe('dt:subsidiary:040483fc-4322-4ce0-b124-cc5b6d2a9cee:2026-10-17:inventory_initial');
    expect(k.length).toBeLessThanOrEqual(80);
  });
});

describe('dayDigest', () => {
  it('resume lo que falta del día', () => {
    const d = dayDigest('Hermosillo', '2026-10-17', {
      subsidiary: [
        row({ refType: 'subsidiary', step: 'inventory_final', status: 'pending' }),
        row({ refType: 'subsidiary', step: 'closure', status: 'partial', doneCount: 4, totalCount: 6 }),
        row({ refType: 'subsidiary', step: 'devolutions', status: 'late', doneCount: 2, totalCount: 11 }),
      ],
      consolidated: [
        { consNumber: 'A', tasks: [row({ status: 'done' })] },
        { consNumber: 'B', tasks: [row({ status: 'late' })] },
        { consNumber: 'C', tasks: [row({ status: 'done' })] },
      ],
      possibleLd: [{}, {}, {}, {}],
    } as any);
    expect(d.subject).toBe('Hermosillo · cierre del día 17 oct');
    expect(d.text).toContain('Listos: 2 de 3 consolidados');
    expect(d.text).toContain('Falta: inventario final de día, 2 rutas sin cerrar, 9 DEX sin devolución');
    expect(d.text).toContain('4 posibles LD');
  });
});
