import { DayTransition } from './daily-tasks.service';
import { TaskRow, TaskStep } from './daily-task.types';

const OFFSET_MS = 7 * 3_600_000;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Hora de Hermosillo en formato de 12 horas ("8:00 p. m."). */
export function hora12(d: Date | string): string {
  const [h, m] = new Date(new Date(d).getTime() - OFFSET_MS).toISOString().slice(11, 16).split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}
const shortDay = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

const STEP_DONE: Record<TaskStep, string> = {
  upload: 'consolidado subido',
  unloading: 'desembarque',
  dispatch: 'salidas a ruta',
  closure: 'cierre de rutas',
  devolutions: 'devoluciones',
  inventory_initial: 'inventario inicial',
  inventory_final: 'inventario final de día',
};
const CONS_LATE: Partial<Record<TaskStep, string>> = {
  unloading: 'sin desembarcar completo',
  dispatch: 'sin salida a ruta',
  closure: 'con rutas sin cerrar',
};
const SUB_LATE: Partial<Record<TaskStep, string>> = {
  inventory_initial: 'Inventario inicial pendiente',
  closure: 'Rutas del día sin cerrar',
  inventory_final: 'Inventario final de día pendiente',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const refLabel = (r: TaskRow) => (r.refType === 'charge' ? `F2 ${r.consNumber ?? ''}` : `Consolidado ${r.consNumber ?? ''}`).trim();

export const tasksLink = (subsidiaryId: string, day: string) => `/operaciones/tareas-del-dia?sucursal=${subsidiaryId}&dia=${day}`;

/** Llave del aviso en `ops_alert` (evita repetir y permite escalar). */
export function alertRefKey(t: Pick<DayTransition, 'row' | 'day'>): string {
  const r = t.row;
  return r.refType === 'subsidiary' ? `dt:subsidiary:${r.refId}:${t.day}:${r.step}` : `dt:${r.refType}:${r.refId}:${r.step}`;
}

/** Mensaje de campana para un cambio de estado; null si ese cambio no avisa. */
export function transitionMessage(t: DayTransition, subsidiaryName: string): { type: string; title: string; body: string; link: string } | null {
  const r = t.row;
  const link = tasksLink(t.subsidiaryId, t.day);
  if (t.to === 'late' && t.from !== 'done') {
    const title = r.refType === 'subsidiary' ? SUB_LATE[r.step] : CONS_LATE[r.step] ? `${refLabel(r)} ${CONS_LATE[r.step]}` : null;
    if (!title) return null;
    return { type: 'tareas.paso_atrasado', title, body: `${subsidiaryName} · venció a las ${hora12(r.dueAt)}`, link };
  }
  if (t.to === 'done') {
    const title = r.refType === 'subsidiary' ? `${cap(STEP_DONE[r.step])} listo` : `${refLabel(r)}: ${STEP_DONE[r.step]} listo`;
    return { type: 'tareas.paso_completo', title, body: r.doneByName ? `${subsidiaryName} · ${r.doneByName}` : subsidiaryName, link };
  }
  return null;
}

type DigestInput = { subsidiary: TaskRow[]; consolidated: { consNumber: string; tasks: TaskRow[] }[]; possibleLd: unknown[]; devolutions?: unknown[] };

/** Resumen de cierre del día (correo de las 19:00). */
export function dayDigest(subsidiaryName: string, day: string, d: DigestInput): { subject: string; text: string; html: string } {
  const listos = d.consolidated.filter((c) => c.tasks.every((t) => t.status === 'done')).length;
  const falta: string[] = [];
  const sub = (s: TaskStep) => d.subsidiary.find((r) => r.step === s);
  if (sub('inventory_initial') && sub('inventory_initial')!.status !== 'done') falta.push('inventario inicial');
  if (sub('inventory_final') && sub('inventory_final')!.status !== 'done') falta.push('inventario final de día');
  const cl = sub('closure');
  if (cl && cl.status !== 'done' && cl.totalCount > cl.doneCount) falta.push(`${cl.totalCount - cl.doneCount} rutas sin cerrar`);

  const lines = [`Listos: ${listos} de ${d.consolidated.length} consolidados`];
  lines.push(falta.length ? `Falta: ${falta.join(', ')}` : 'No falta nada de la sucursal');
  if (d.devolutions?.length) lines.push(`${d.devolutions.length} devoluciones registradas`);
  if (d.possibleLd.length) lines.push(`${d.possibleLd.length} posibles LD`);
  const subject = `${subsidiaryName} · cierre del día ${shortDay(day)}`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<h3 style="margin:0 0 8px">${esc(subject)}</h3>${lines.map((l) => `<p style="margin:4px 0">${esc(l)}</p>`).join('')}`;
  return { subject, text: lines.join('\n'), html };
}
