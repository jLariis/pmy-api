import { isoWeekKey, weeklyDex08ChargeIndexes } from './dex08-week.util';

const D = (iso: string) => new Date(iso);

describe('isoWeekKey (lun–dom)', () => {
  it('lunes y domingo de la misma semana comparten clave', () => {
    // 2026-08-31 = lunes (sem 36), 2026-09-06 = domingo (sem 36)
    expect(isoWeekKey(D('2026-08-31T12:00:00Z'))).toBe(isoWeekKey(D('2026-09-06T12:00:00Z')));
  });
  it('domingo y el lunes siguiente NO comparten clave', () => {
    // 2026-08-30 = domingo (sem 35), 2026-08-31 = lunes (sem 36)
    expect(isoWeekKey(D('2026-08-30T12:00:00Z'))).not.toBe(isoWeekKey(D('2026-08-31T12:00:00Z')));
  });
});

describe('weeklyDex08ChargeIndexes — 3 en la MISMA semana', () => {
  it('3 nuevos en la misma semana → dispara en el 3ro', () => {
    const nuevos = [D('2026-08-25T10:00:00Z'), D('2026-08-26T10:00:00Z'), D('2026-08-27T10:00:00Z')]; // sem 35
    expect(weeklyDex08ChargeIndexes([], nuevos)).toEqual([2]);
  });

  it('2 previos en la semana + 1 nuevo en la MISMA semana → dispara', () => {
    const previos = [D('2026-08-25T10:00:00Z'), D('2026-08-26T10:00:00Z')]; // sem 35
    const nuevos = [D('2026-08-27T10:00:00Z')]; // sem 35
    expect(weeklyDex08ChargeIndexes(previos, nuevos)).toEqual([0]);
  });

  it('CASO REAL 383295956902: 28,29 ago (sem35) + 31 ago (sem36) → NO cobra', () => {
    const nuevos = [D('2026-08-28T21:05:00Z'), D('2026-08-29T21:44:00Z'), D('2026-08-31T17:20:00Z')];
    expect(weeklyDex08ChargeIndexes([], nuevos)).toEqual([]);
  });

  it('CASO REAL 876104119598: 27 ago (sem35) + 31 ago, 1 sep (sem36) → NO cobra', () => {
    const previos = [D('2026-08-27T20:59:00Z')]; // sem 35, ciclo anterior
    const nuevos = [D('2026-08-31T22:00:00Z'), D('2026-09-01T23:42:00Z')]; // sem 36
    expect(weeklyDex08ChargeIndexes(previos, nuevos)).toEqual([]);
  });

  it('semana que ya tenía 3 de historial → un 08 nuevo no re-dispara', () => {
    const previos = [D('2026-08-24T10:00:00Z'), D('2026-08-25T10:00:00Z'), D('2026-08-26T10:00:00Z')]; // sem 35 (3)
    const nuevos = [D('2026-08-27T10:00:00Z')]; // sem 35 (4º)
    expect(weeklyDex08ChargeIndexes(previos, nuevos)).toEqual([]);
  });

  it('cada semana dispara su propio 3ro cronológico (índice al arreglo original, sin reordenar)', () => {
    const nuevos = [
      D('2026-08-27T10:00:00Z'), // sem 35, el MÁS TARDÍO → 3ro cronológico (idx 0)
      D('2026-09-01T10:00:00Z'), // sem 36
      D('2026-08-25T10:00:00Z'), // sem 35
      D('2026-09-02T10:00:00Z'), // sem 36
      D('2026-08-24T10:00:00Z'), // sem 35, el más viejo
      D('2026-09-03T10:00:00Z'), // sem 36, el MÁS TARDÍO → 3ro cronológico (idx 5)
    ];
    expect(weeklyDex08ChargeIndexes([], nuevos).sort((a, b) => a - b)).toEqual([0, 5]);
  });
});

describe('weeklyDex08ChargeIndexes — cuenta DÍAS distintos (anti-duplicado)', () => {
  it('3 eventos 08 el MISMO día → NO cobra (1 sola visita re-escaneada)', () => {
    const nuevos = [
      D('2026-08-25T09:00:00Z'),
      D('2026-08-25T15:00:00Z'),
      D('2026-08-25T20:00:00Z'),
    ]; // mismo día 25 → 1 visita
    expect(weeklyDex08ChargeIndexes([], nuevos)).toEqual([]);
  });

  it('BUG "cobra con 1": 2 filas 08 del MISMO día en historial + 1 nuevo día → NO cobra (solo 2 días distintos)', () => {
    const previos = [D('2026-08-25T09:00:00Z'), D('2026-08-25T18:00:00Z')]; // duplicado del día 25
    const nuevos = [D('2026-08-26T10:00:00Z')]; // día 26
    expect(weeklyDex08ChargeIndexes(previos, nuevos)).toEqual([]); // {25,26} = 2 días
  });

  it('2 días distintos + un re-escaneo de uno de ellos + un 3er día → cobra en el 3er DÍA distinto', () => {
    const nuevos = [
      D('2026-08-24T10:00:00Z'), // día 24 (1)
      D('2026-08-25T10:00:00Z'), // día 25 (2)
      D('2026-08-25T22:00:00Z'), // re-escaneo día 25 → no suma
      D('2026-08-26T10:00:00Z'), // día 26 (3) → dispara aquí (idx 3)
    ];
    expect(weeklyDex08ChargeIndexes([], nuevos)).toEqual([3]);
  });

  it('1 día previo + re-escaneo del mismo día + 2 días nuevos → cobra en el 3er día distinto', () => {
    const previos = [D('2026-08-24T10:00:00Z')]; // día 24 (1)
    const nuevos = [
      D('2026-08-24T23:00:00Z'), // re-escaneo día 24 → no suma
      D('2026-08-25T10:00:00Z'), // día 25 (2)
      D('2026-08-26T10:00:00Z'), // día 26 (3) → dispara (idx 2)
    ];
    expect(weeklyDex08ChargeIndexes(previos, nuevos)).toEqual([2]);
  });
});
