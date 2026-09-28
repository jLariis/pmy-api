import { assignWeekMarks, weekDaysOf } from './manual-count-week.util';
import { DiagnosisRow } from './manual-count.types';

const row = (p: Partial<DiagnosisRow>): DiagnosisRow =>
  ({ trackingNumber: 'X', manual: null, fedexSays: null, systemSays: null, charged: [], expected: null, ...p }) as DiagnosisRow;

describe('weekDaysOf', () => {
  it('da lunes–domingo para cualquier día de la semana', () => {
    expect(weekDaysOf('2026-09-24')).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
    expect(weekDaysOf('2026-09-27')[0]).toBe('2026-09-21'); // domingo → lunes anterior
    expect(weekDaysOf('2026-09-21')[6]).toBe('2026-09-27');
  });
});

describe('assignWeekMarks', () => {
  it('DEX08 va al día que debía cobrar (3er día con 08), no al último 08', () => {
    const byDay = [
      { day: 'L', row: row({ fedexSays: '08' }) },
      { day: 'M', row: row({ fedexSays: '08' }) },
      { day: 'X', row: row({ fedexSays: '08', expected: '08' }) },
      { day: 'J', row: row({ fedexSays: '08' }) },
    ];
    expect([...assignWeekMarks(['08'], byDay)]).toEqual([['X', '08']]);
  });

  it('una guía con DEX08 y POD en la semana asigna cada marca a su día', () => {
    const byDay = [
      { day: 'L', row: row({ fedexSays: '08' }) },
      { day: 'V', row: row({ fedexSays: 'POD', expected: 'POD', charged: ['POD'] }) },
    ];
    const out = assignWeekMarks(['POD', '08'], byDay);
    expect(out.get('V')).toBe('POD');
    expect(out.get('L')).toBe('08');
  });

  it('sin coincidencias va al último día con movimiento de FedEx, o al primero', () => {
    expect([...assignWeekMarks(['POD'], [{ day: 'L', row: row({}) }, { day: 'M', row: row({ fedexSays: 'OTRO' }) }, { day: 'X', row: row({}) }])]).toEqual([['M', 'POD']]);
    expect([...assignWeekMarks(['07'], [{ day: 'L', row: row({}) }, { day: 'M', row: row({}) }])]).toEqual([['L', '07']]);
  });
});
