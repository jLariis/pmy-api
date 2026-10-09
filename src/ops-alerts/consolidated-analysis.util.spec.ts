import { analyzeConsolidated, buildNoticeMessage, GuideFact } from './consolidated-analysis.util';

const now = new Date('2026-10-09T02:00:00.000Z');
const receivedAt = new Date('2026-10-08T17:00:00.000Z');
const g = (tn: string, over: Partial<GuideFact> = {}): GuideFact => ({ trackingNumber: tn, status: 'pendiente', unloaded: false, routed: false, closed: false, ...over });

describe('analyzeConsolidated', () => {
  it('no subido: solo ese hallazgo, con cuánto lleva', () => {
    const f = analyzeConsolidated({ receivedAt, announcedCount: 54, guides: [], now });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: 'no_subido', severity: 'alta', count: 54 });
    expect(f[0].text).toBe('No se ha subido: el correo llegó hace 9 h con 54 guías.');
  });

  it('cada caso fuera de orden en su hallazgo', () => {
    const f = analyzeConsolidated({
      receivedAt,
      announcedCount: 7,
      now,
      guides: [
        g('A', { status: 'entregado' }), // entregada sin desembarque ni ruta
        g('B', { routed: true }), // ruta sin desembarque (y sin cierre)
        g('C'), // falta desembarque
        g('D', { unloaded: true }), // desembarcada sin ruta
        g('E', { unloaded: true, routed: true, closed: true }), // completa
        g('F', { status: 'devuelto_a_fedex' }), // final: no cuenta como pendiente
      ],
    });
    const by = Object.fromEntries(f.map((x) => [x.code, x]));
    expect(by.subida_parcial.text).toBe('Solo se subieron 6 de 7 guías anunciadas en el correo.');
    expect(by.entregadas_sin_desembarque).toMatchObject({ count: 1, samples: ['A'] });
    expect(by.ruta_sin_desembarque).toMatchObject({ count: 1, samples: ['B'] });
    expect(by.desembarque_incompleto.text).toBe('Faltan 1 de 6 guías por desembarcar.');
    expect(by.sin_ruta).toMatchObject({ count: 1, samples: ['D'] });
    expect(by.ruta_sin_cierre).toMatchObject({ count: 1, samples: ['B'] });
    expect(by.sin_pendientes).toBeUndefined();
  });

  it('todo completo → sin pendientes', () => {
    const f = analyzeConsolidated({ receivedAt, announcedCount: 2, now, guides: [g('A', { unloaded: true, routed: true, closed: true }), g('B', { unloaded: true, routed: true, closed: true })] });
    expect(f.map((x) => x.code)).toEqual(['sin_pendientes']);
  });
});

describe('buildNoticeMessage', () => {
  it('encabezado, avance, hallazgos con ejemplos, nota y quién lo manda', () => {
    const findings = analyzeConsolidated({ receivedAt, announcedCount: null, now, guides: [g('A', { routed: true }), g('B', { routed: true })] });
    const text = buildNoticeMessage({
      subsidiaryName: 'Cabo San Lucas', consNumber: '305822252547', kindLabel: 'Master', receivedAt,
      progress: { total: 2, unloaded: 0, routed: 2, closed: 0 }, findings: findings.filter((x) => x.code === 'ruta_sin_desembarque'),
      note: 'Revisen hoy, por favor', senderName: 'Javier Laris', withSamples: true,
    });
    expect(text).toContain('📣 *Aviso · Cabo San Lucas*');
    expect(text).toContain('Master 305822252547 · llegó');
    expect(text).toContain('Guías: 2 · desembarque 0 · en ruta 2 · con cierre 0');
    expect(text).toContain('🔴 2 guías salieron a ruta sin desembarque.\n   A, B');
    expect(text).toContain('📝 Revisen hoy, por favor');
    expect(text.endsWith('— Javier Laris')).toBe(true);
  });
});
