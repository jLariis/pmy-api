import { buildAlertDigest, lateText } from './alert-digest.util';

describe('buildAlertDigest', () => {
  const now = new Date('2026-10-09T02:15:00.000Z'); // 19:15 Hermosillo

  it('un mensaje agrupado por sucursal, lo más grave primero', () => {
    const text = buildAlertDigest(
      [
        { level: 1, subsidiaryName: 'La Paz', step: 'Inventario del día', consNumber: null, minutesLate: 15, pct: 0 },
        { level: 3, subsidiaryName: 'Cabo San Lucas', step: 'Desembarque', consNumber: '305822252547', minutesLate: 75, pct: 40 },
        { level: 1, subsidiaryName: 'Cabo San Lucas', step: 'Subir el consolidado', consNumber: '305822182422', minutesLate: 12, pct: 0 },
      ],
      now,
    );
    expect(text.split('\n')[0]).toBe('🚨 *Alertas operativas* · 07:15 p.m.');
    expect(text).toContain('3 pendientes nuevos o con más atraso:');
    expect(text.indexOf('*Cabo San Lucas*')).toBeLessThan(text.indexOf('*La Paz*'));
    expect(text).toContain('🚨 Desembarque · 305822252547 — 1 h 15 min de atraso (va al 40%)');
    expect(text).toContain('⏰ Subir el consolidado · 305822182422 — 12 min de atraso');
    expect(text).toContain('⏰ Inventario del día — 15 min de atraso');
  });

  it('atraso en llano', () => {
    expect(lateText(5)).toBe('5 min');
    expect(lateText(60)).toBe('1 h');
    expect(lateText(125)).toBe('2 h 5 min');
  });
});
