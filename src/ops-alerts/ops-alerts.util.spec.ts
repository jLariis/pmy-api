import { alertLevel, atLocalTime, computeSteps, inActiveHours, localDay, OpsSettings, StepProgress } from './ops-alerts.util';

const S: OpsSettings = {
  enabled: true,
  uploadMinutes: 30,
  unloadingTime: '21:00',
  dispatchTime: '10:00',
  closureTime: '21:00',
  inventoryTime: '19:00',
  escalate1Min: 30,
  escalate2Min: 60,
  completePct: 100,
  lookbackDays: 3,
  activeFrom: '06:00',
  activeTo: '21:30',
};
const ALL = { upload: true, unloading: true, dispatch: true, closure: true, inventory: true };
const none: StepProgress = { done: 0, total: 189, first: null, last: null };
const full = (at: string): StepProgress => ({ done: 189, total: 189, first: new Date(at), last: new Date(at) });

describe('ops-alerts.util', () => {
  it('hora local de Hermosillo (UTC−7)', () => {
    expect(localDay(new Date('2026-10-02T02:32:00Z'))).toBe('2026-10-01');
    expect(atLocalTime('2026-10-01', '21:00').toISOString()).toBe('2026-10-02T04:00:00.000Z');
  });

  it('subir: vence 30 min después del correo; desembarque espera a que se suba', () => {
    const steps = computeSteps(
      { receivedAt: new Date('2026-10-01T19:00:00Z'), uploadedAt: null, unloading: none, dispatch: none, closure: none },
      S,
      ALL,
    );
    expect(steps.map((s) => s.step)).toEqual(['upload']);
    expect(steps[0]).toMatchObject({ done: false, dueAt: new Date('2026-10-01T19:30:00Z') });
  });

  it('subido a las 12:00 local → desembarque vence 21:00 del mismo día; salida 10:00 del día siguiente', () => {
    const steps = computeSteps(
      { receivedAt: new Date('2026-10-01T18:40:00Z'), uploadedAt: new Date('2026-10-01T19:00:00Z'), unloading: full('2026-10-01T23:00:00Z'), dispatch: none, closure: none },
      S,
      ALL,
    );
    const by = Object.fromEntries(steps.map((s) => [s.step, s]));
    expect(by.upload.done).toBe(true);
    expect(by.unloading).toMatchObject({ done: true, dueAt: new Date('2026-10-02T04:00:00Z') });
    expect(by.dispatch).toMatchObject({ done: false, dueAt: new Date('2026-10-02T17:00:00Z') }); // 10:00 local del 2-oct
    expect(by.closure).toBeUndefined(); // aún no sale a ruta
  });

  it('subido después de las 21:00 → desembarque vence 2 h después de subir', () => {
    const steps = computeSteps(
      { receivedAt: new Date('2026-10-02T04:30:00Z'), uploadedAt: new Date('2026-10-02T04:40:00Z'), unloading: none, dispatch: none, closure: none },
      S,
      ALL,
    );
    expect(steps.find((s) => s.step === 'unloading')?.dueAt).toEqual(new Date('2026-10-02T06:40:00Z'));
  });

  it('sucursal sin desembarque: la salida se ancla a la subida', () => {
    const steps = computeSteps(
      { receivedAt: new Date('2026-10-01T18:40:00Z'), uploadedAt: new Date('2026-10-01T19:00:00Z'), unloading: none, dispatch: none, closure: none },
      S,
      { ...ALL, unloading: false },
    );
    expect(steps.map((s) => s.step)).toEqual(['upload', 'dispatch']);
  });

  it('cierre vence el día de la primera salida a las 21:00; avance parcial no cuenta como hecho', () => {
    const steps = computeSteps(
      {
        receivedAt: new Date('2026-10-01T18:40:00Z'),
        uploadedAt: new Date('2026-10-01T19:00:00Z'),
        unloading: full('2026-10-01T23:00:00Z'),
        dispatch: full('2026-10-02T15:00:00Z'),
        closure: { done: 150, total: 189, first: new Date('2026-10-03T02:00:00Z'), last: new Date('2026-10-03T02:00:00Z') },
      },
      S,
      ALL,
    );
    const closure = steps.find((s) => s.step === 'closure')!;
    expect(closure).toMatchObject({ done: false, dueAt: new Date('2026-10-03T04:00:00Z') });
    expect(closure.pct).toBe(79);
  });

  it('nivel de escalamiento por minutos de atraso', () => {
    const due = new Date('2026-10-01T19:30:00Z');
    expect(alertLevel(due, new Date('2026-10-01T19:29:00Z'), S)).toBe(0);
    expect(alertLevel(due, new Date('2026-10-01T19:31:00Z'), S)).toBe(1);
    expect(alertLevel(due, new Date('2026-10-01T20:01:00Z'), S)).toBe(2);
    expect(alertLevel(due, new Date('2026-10-01T20:31:00Z'), S)).toBe(3);
  });

  it('horario activo 06:00–21:30 local', () => {
    expect(inActiveHours(new Date('2026-10-01T13:00:00Z'), S)).toBe(true); // 06:00
    expect(inActiveHours(new Date('2026-10-02T04:29:00Z'), S)).toBe(true); // 21:29
    expect(inActiveHours(new Date('2026-10-02T04:31:00Z'), S)).toBe(false); // 21:31
    expect(inActiveHours(new Date('2026-10-01T12:59:00Z'), S)).toBe(false); // 05:59
  });
});
