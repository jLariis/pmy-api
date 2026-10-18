import { DailyTasksNotifier } from './daily-tasks.cron';

const settings = { enabled: true, activeFrom: '06:00', activeTo: '21:30', escalate1Min: 30, escalate2Min: 60, alertGroupsLevel: 1 };
// 2026-10-17 12:00 en Hermosillo.
const NOW = new Date('2026-10-17T19:00:00Z');

function make(o: { rows?: any[]; late?: any[]; cfg?: any; enabled?: boolean; bootAt?: Date } = {}) {
  const sent: any[] = [];
  const wa: any[] = [];
  const savedTasks: any[] = [];
  const savedAlerts: any[] = [];
  const tasks: any = { refreshOpenDays: async () => [], activeSubsidiaries: async () => [{ id: 's1', name: 'Hermosillo' }] };
  const opsAlerts: any = { getSettings: async () => ({ ...settings, enabled: o.enabled ?? true }), subsidiaryUsers: async () => ['u1'] };
  const sendLog: any = { notifyUsers: async (_u: any, e: any) => sent.push(e), whatsappTo: async (to: any, text: string) => wa.push({ to, text }) };
  const alertRepo: any = { findOne: async () => null, create: (x: any) => x, save: async (a: any) => savedAlerts.push(a) };
  const subRepo: any = { findOne: async () => o.cfg ?? { whatsappNumbers: ['526620000000'] } };
  const taskRepo: any = {
    find: async ({ where }: any) => (where.status === 'late' ? o.late ?? [] : o.rows ?? []),
    save: async (r: any) => savedTasks.push(...(Array.isArray(r) ? r : [r])),
  };
  const n = new DailyTasksNotifier(tasks, opsAlerts, sendLog, alertRepo, subRepo, taskRepo, {} as any);
  (n as any).bootAt = o.bootAt ?? new Date('2026-10-17T13:00:00Z');
  return { n, sent, wa, savedTasks, savedAlerts };
}

const row = (o: any) => ({
  id: 'r1', subsidiaryId: 's1', day: '2026-10-17', refType: 'consolidated', refId: 'c1', consNumber: '7781', step: 'closure',
  status: 'done', notifiedStatus: 'partial', doneCount: 3, totalCount: 3, dueAt: new Date('2026-10-18T04:00:00Z'), doneAt: NOW, doneByName: 'Ana', ...o,
});

describe('DailyTasksNotifier.tick', () => {
  it('avisa "listo" una vez y marca la fila como avisada (aunque la pantalla la haya guardado antes)', async () => {
    const { n, sent, savedTasks } = make({ rows: [row({})] });
    await n.tick(NOW);
    expect(sent.map((e) => e.type)).toEqual(['tareas.paso_completo']);
    expect(savedTasks[0]).toMatchObject({ id: 'r1', notifiedStatus: 'done' });
  });

  it('con las alertas apagadas no avisa, pero marca para no soltar todo al prenderlas', async () => {
    const { n, sent, savedTasks } = make({ rows: [row({})], enabled: false });
    await n.tick(NOW);
    expect(sent).toEqual([]);
    expect(savedTasks[0]).toMatchObject({ notifiedStatus: 'done' });
  });

  it('paso con avisos apagados en la sucursal: no avisa', async () => {
    const { n, sent } = make({ rows: [row({})], cfg: { stepClosure: false } });
    await n.tick(NOW);
    expect(sent).toEqual([]);
  });

  it('atraso que ya venía vencido antes de arrancar el servidor: se registra sin avisar', async () => {
    const late = [row({ status: 'late', step: 'dispatch', dueAt: new Date('2026-10-17T12:00:00Z') })];
    const { n, sent, wa, savedAlerts } = make({ late });
    await n.tick(NOW);
    expect(sent).toEqual([]);
    expect(wa).toEqual([]);
    expect(savedAlerts[0]).toMatchObject({ level: 3 });
  });

  it('atraso nuevo de hoy con el servidor arriba: campana', async () => {
    const late = [row({ status: 'late', step: 'dispatch', dueAt: new Date('2026-10-17T18:50:00Z') })];
    const { n, sent } = make({ late });
    await n.tick(NOW);
    expect(sent.map((e) => e.type)).toEqual(['tareas.paso_atrasado']);
  });
});
