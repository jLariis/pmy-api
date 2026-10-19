import { diffTasks, taskKey } from './daily-task-diff.util';
import { TaskRow, TaskStatus } from './daily-task.types';

const row = (status: TaskStatus, step: TaskRow['step'] = 'unloading', refId = 'c1'): TaskRow => ({
  refType: 'consolidated', refId, consNumber: '7781', step, status, doneCount: 0, totalCount: 10, dueAt: new Date(0), doneAt: null, doneById: null, doneByName: null,
});

describe('diffTasks', () => {
  it('pending → partial es transición', () => {
    expect(diffTasks([row('pending')], [row('partial')])).toEqual([{ row: row('partial'), from: 'pending', to: 'partial' }]);
  });

  it('partial → done es transición', () => {
    expect(diffTasks([row('partial')], [row('done')]).map((t) => t.to)).toEqual(['done']);
  });

  it('sin cambio de estado no emite', () => {
    expect(diffTasks([row('done')], [row('done')])).toEqual([]);
  });

  it('fila nueva pending no emite; fila nueva late sí (from null)', () => {
    expect(diffTasks([], [row('pending')])).toEqual([]);
    expect(diffTasks([], [row('late', 'dispatch')])).toEqual([{ row: row('late', 'dispatch'), from: null, to: 'late' }]);
  });

  it('distingue filas por referencia y paso', () => {
    expect(taskKey(row('done', 'closure', 'c2'))).toBe('consolidated:c2:closure');
    expect(diffTasks([row('pending', 'unloading', 'c1')], [row('pending', 'unloading', 'c1'), row('late', 'unloading', 'c2')]).length).toBe(1);
  });
});
