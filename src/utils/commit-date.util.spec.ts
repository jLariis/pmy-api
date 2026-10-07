import {
  commitInstantHermosillo,
  parseCommitDate,
  parseCommitTime,
  readCommitCells,
  summarizeCommitDates,
  todayDefaultCommitHermosillo,
} from './commit-date.util';

describe('parseCommitDate', () => {
  it('lee M/D/AAAA de FedEx', () => {
    expect(parseCommitDate('10/14/2026')).toMatchObject({ iso: '2026-10-14', status: 'ok', ambiguous: false });
  });

  it('lee D/M/AAAA cuando el día es > 12', () => {
    expect(parseCommitDate('14/10/2026').iso).toBe('2026-10-14');
  });

  it('día/mes intercambiable sin referencia → M/D (FedEx), sin aviso', () => {
    expect(parseCommitDate('10/7/2026')).toMatchObject({ iso: '2026-10-07', ambiguous: false });
  });

  it('con referencia gana la lectura creíble respecto al consolidado', () => {
    // 07/10/2026 con consolidado del 6-oct: 7-oct (D/M), no 10-jul (M/D).
    expect(parseCommitDate('07/10/2026', '2026-10-06')).toMatchObject({ iso: '2026-10-07', ambiguous: false });
    expect(parseCommitDate('10/07/2026', '2026-10-06')).toMatchObject({ iso: '2026-10-07', ambiguous: false });
  });

  it('ambigua solo si las dos lecturas son creíbles (gana la más cercana)', () => {
    // Consolidado 11-nov: 11/12 puede ser 12-nov (+1) o 11-dic (+30).
    expect(parseCommitDate('11/12/2026', '2026-11-11')).toMatchObject({ iso: '2026-11-12', ambiguous: true });
  });

  it('lee AAAA-MM-DD, con o sin hora', () => {
    expect(parseCommitDate('2026-10-07').iso).toBe('2026-10-07');
    expect(parseCommitDate('2026-10-07 18:00:00').iso).toBe('2026-10-07');
  });

  it('lee el serial de Excel (número o texto)', () => {
    expect(parseCommitDate(46302).iso).toBe('2026-10-07');
    expect(parseCommitDate('46302.75').iso).toBe('2026-10-07');
  });

  it('lee año de 2 dígitos y mes con nombre', () => {
    expect(parseCommitDate('10/7/26').iso).toBe('2026-10-07');
    expect(parseCommitDate('7-Oct-26').iso).toBe('2026-10-07');
    expect(parseCommitDate('7 dic 2026').iso).toBe('2026-12-07');
    expect(parseCommitDate('Oct 7, 2026').iso).toBe('2026-10-07');
  });

  it('vacío vs inválido', () => {
    expect(parseCommitDate('').status).toBe('empty');
    expect(parseCommitDate(undefined).status).toBe('empty');
    expect(parseCommitDate('mañana').status).toBe('invalid');
    expect(parseCommitDate('31/02/2026').status).toBe('invalid');
    expect(parseCommitDate('13/13/2026').status).toBe('invalid');
  });
});

describe('parseCommitTime', () => {
  it('fracción de Excel', () => {
    expect(parseCommitTime(0.75).time).toBe('18:00:00');
    expect(parseCommitTime('0.5').time).toBe('12:00:00');
    expect(parseCommitTime(46302.75).time).toBe('18:00:00');
  });

  it('texto HH:mm y AM/PM', () => {
    expect(parseCommitTime('18:00').time).toBe('18:00:00');
    expect(parseCommitTime('6:00 PM').time).toBe('18:00:00');
    expect(parseCommitTime('12:00 a. m.').time).toBe('00:00:00');
    expect(parseCommitTime('10:30:15 am').time).toBe('10:30:15');
    expect(parseCommitTime('6 PM').time).toBe('18:00:00');
    expect(parseCommitTime('1830').time).toBe('18:30:00');
  });

  it('vacío vs inválido', () => {
    expect(parseCommitTime('').status).toBe('empty');
    expect(parseCommitTime('25:00').status).toBe('invalid');
    expect(parseCommitTime('tarde').status).toBe('invalid');
  });
});

describe('readCommitCells', () => {
  it('una hora mala NO tira la fecha (antes sí)', () => {
    expect(readCommitCells('10/07/2026', 'tarde')).toMatchObject({
      commitDate: '2026-10-07', commitTime: '18:00:00', timeStatus: 'invalid',
    });
  });

  it('sin hora → 18:00', () => {
    expect(readCommitCells('10/07/2026', '')).toMatchObject({ commitTime: '18:00:00', timeStatus: 'empty' });
  });
});

describe('instantes en Hermosillo', () => {
  it('18:00 Hermosillo = 01:00Z del día siguiente', () => {
    expect(commitInstantHermosillo('2026-10-07', '18:00:00')!.toISOString()).toBe('2026-10-08T01:00:00.000Z');
  });

  it('respaldo de hoy a las 18:00 usa el día de Hermosillo, no el de UTC', () => {
    // 6-oct 22:00 Hermosillo = 7-oct 05:00Z → sigue siendo 6-oct en Hermosillo.
    expect(todayDefaultCommitHermosillo(new Date('2026-10-07T05:00:00Z')).toISOString()).toBe('2026-10-07T01:00:00.000Z');
  });
});

describe('summarizeCommitDates', () => {
  it('cuenta por día y detecta problemas contra la fecha del consolidado', () => {
    const sum = summarizeCommitDates([
      { trackingNumber: 'A', commitDate: '2026-10-06', commitIssue: null },
      { trackingNumber: 'B', commitDate: '2026-10-06', commitIssue: 'ambigua' },
      { trackingNumber: 'C', commitDate: '2026-10-03', commitIssue: null },
      { trackingNumber: 'D', commitDate: '2026-12-20', commitIssue: null },
      { trackingNumber: 'E', commitDate: null, commitIssue: 'sin_fecha' },
      { trackingNumber: '', commitDate: '2026-10-06', commitIssue: null }, // sin guía: se ignora
    ], '2026-10-05');
    expect(sum.byDay).toEqual([
      { day: '2026-10-03', count: 1 }, { day: '2026-10-06', count: 2 }, { day: '2026-12-20', count: 1 },
    ]);
    expect(sum).toMatchObject({ sinFecha: 1, ambiguas: 1, antesDelConsolidado: 1, muyLejanas: 1 });
    expect(sum.ejemplos.antes_del_consolidado).toEqual(['C']);
  });
});
