import { TaskRow, TaskStatus } from './daily-task.types';

export type Transition = { row: TaskRow; from: TaskStatus | null; to: TaskStatus };

export const taskKey = (r: Pick<TaskRow, 'refType' | 'refId' | 'step'>) => `${r.refType}:${r.refId}:${r.step}`;

/** Cambios reales de estado entre la foto guardada y la recién calculada. Una fila nueva solo cuenta si ya nace tarde. */
export function diffTasks(prev: TaskRow[], next: TaskRow[]): Transition[] {
  const before = new Map(prev.map((r) => [taskKey(r), r.status]));
  const out: Transition[] = [];
  for (const row of next) {
    const from = before.get(taskKey(row)) ?? null;
    if (from === row.status) continue;
    if (from === null && row.status !== 'late') continue;
    out.push({ row, from, to: row.status });
  }
  return out;
}
