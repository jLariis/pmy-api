import { AlertBlock, buildAlertDigest, buildAlertMessage, lateText, pickUsualUploaders } from './alert-digest.util';

const now = new Date('2026-10-09T02:15:00.000Z'); // 7:15 p.m. Hermosillo
const cabo: AlertBlock = {
  level: 3, subsidiaryId: 'cabo', subsidiaryName: 'Cabo San Lucas', step: 'Desembarque', stepCode: 'unloading',
  consNumber: '305822252547', kindLabel: 'Master', receivedAt: new Date('2026-10-06T22:22:00.000Z'), minutesLate: 75, pct: 40,
  progress: { total: 36, unloaded: 0, routed: 36, closed: 0 },
  findings: [
    { code: 'ruta_sin_desembarque', severity: 'alta', text: '36 guías salieron a ruta sin desembarque.', count: 36, samples: [] },
    { code: 'sin_pendientes', severity: 'info', text: 'no debe salir', count: 0, samples: [] },
  ],
};
const lapaz: AlertBlock = {
  level: 1, subsidiaryId: 'lapaz', subsidiaryName: 'La Paz', step: 'Inventario del día', stepCode: 'inventory',
  consNumber: null, kindLabel: null, receivedAt: null, minutesLate: 15, pct: 0, progress: null, findings: [],
};
const uploaders = new Map([['cabo', ['Marisol López Ruiz', 'Wendy Castro Peña']], ['lapaz', ['Ana Torres Gil']]]);

describe('buildAlertDigest', () => {
  it('estilo aviso: por sucursal, quién lo sube, avance, paso vencido y hallazgos', () => {
    const text = buildAlertDigest([lapaz, cabo], uploaders, now);
    expect(text.split('\n')[0]).toBe('🚨 *Alertas operativas* · 7:15 p.m.');
    expect(text).toContain('2 pendientes con atraso');
    expect(text.indexOf('📣 *Cabo San Lucas*')).toBeLessThan(text.indexOf('📣 *La Paz*'));
    expect(text).toContain('Lo suben normalmente: Marisol López Ruiz, Wendy Castro Peña');
    expect(text).toContain('Master 305822252547 · llegó el 06 de Octubre a las 3:22 p.m.');
    expect(text).toContain('Guías: 36 · desembarque 0 · en ruta 36 · con cierre 0');
    expect(text).toContain('🚨 Desembarque: venció hace 1 h 15 min (va al 40%)');
    expect(text).toContain('🔴 36 guías salieron a ruta sin desembarque.');
    expect(text).not.toContain('no debe salir');
    expect(text).toContain('Lo sube normalmente: Ana Torres Gil');
    expect(text).toContain('⏰ Inventario del día: venció hace 15 min');
  });

  it('master y aéreo con el mismo número salen una sola vez', () => {
    const text = buildAlertDigest([cabo, { ...cabo, kindLabel: 'Aéreo' }], uploaders, now);
    expect(text.match(/305822252547/g)).toHaveLength(1);
    expect(text).toContain('1 pendiente con atraso');
  });

  it('modo prueba lo dice en el título', () => {
    expect(buildAlertDigest([lapaz], uploaders, now, { test: true }).split('\n')[0]).toBe('⏰ *Alertas operativas (prueba)* · 7:15 p.m.');
  });

  it('no subido: no repite el hallazgo que ya dice la línea del paso', () => {
    const b: AlertBlock = {
      ...cabo, level: 1, step: 'Subir el consolidado', stepCode: 'upload', progress: { total: 0, unloaded: 0, routed: 0, closed: 0 }, pct: 0, minutesLate: 20,
      findings: [{ code: 'no_subido', severity: 'alta', text: 'No se ha subido: el correo llegó hace 1 día.', count: 5, samples: [] }],
    };
    const text = buildAlertMessage(b, ['Marisol López Ruiz']);
    expect(text).toContain('📣 *Alerta · Cabo San Lucas*');
    expect(text).toContain('Lo sube normalmente: Marisol López Ruiz');
    expect(text).toContain('Guías: no se ha subido');
    expect(text).toContain('⏰ Subir el consolidado: venció hace 20 min');
    expect(text).not.toContain('No se ha subido: el correo');
  });
});

describe('pickUsualUploaders', () => {
  it('la que más sube y la segunda solo si sube 1 de cada 5 o más', () => {
    expect(pickUsualUploaders([{ name: 'A', n: 8 }, { name: 'B', n: 2 }])).toEqual(['A', 'B']);
    expect(pickUsualUploaders([{ name: 'A', n: 9 }, { name: 'B', n: 1 }])).toEqual(['A']);
    expect(pickUsualUploaders([])).toEqual([]);
  });

  it('atraso en llano', () => {
    expect(lateText(5)).toBe('5 min');
    expect(lateText(60)).toBe('1 h');
    expect(lateText(125)).toBe('2 h 5 min');
    expect(lateText(3725)).toBe('2 días 14 h');
    expect(lateText(1440)).toBe('1 día');
  });
});
