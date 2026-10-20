import { sqlDay } from './sql-day.util';

describe('sqlDay', () => {
  it('texto → AAAA-MM-DD', () => expect(sqlDay('2026-10-12 00:00:00')).toBe('2026-10-12'));
  it('DATE de mysql2 (medianoche local) → el mismo día', () => expect(sqlDay(new Date(2026, 9, 12))).toBe('2026-10-12'));
  it('null → null', () => expect(sqlDay(null)).toBeNull());
});
