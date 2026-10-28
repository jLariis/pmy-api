import { decideMasterRemoval, isSameHermosilloDay } from './f2-master-removal.util';

const NOW = new Date('2026-10-28T20:00:00Z'); // 28-oct 13:00 Hermosillo
const base = { hasDispatch: false, hasActiveIncome: false, status: 'pendiente', createdAt: new Date('2026-10-28T16:00:00Z'), now: NOW };

describe('isSameHermosilloDay', () => {
  it('compara el día de Hermosillo, no el día UTC', () => {
    // 29-oct 02:00Z = 28-oct 19:00 Hermosillo → mismo día que NOW.
    expect(isSameHermosilloDay(new Date('2026-10-29T02:00:00Z'), NOW)).toBe(true);
    // 28-oct 06:00Z = 27-oct 23:00 Hermosillo → día anterior.
    expect(isSameHermosilloDay(new Date('2026-10-28T06:00:00Z'), NOW)).toBe(false);
  });
});

describe('decideMasterRemoval (F2 sobre paquete que el master subió el mismo día)', () => {
  it('paquete subido hoy en el master (sin ruta ni ingreso) → se elimina del master', () => {
    expect(decideMasterRemoval(base)).toEqual({ action: 'remove' });
  });

  it('paquete de un día anterior → no se toca (es otro registro de la guía)', () => {
    expect(decideMasterRemoval({ ...base, createdAt: new Date('2026-10-27T20:00:00Z') })).toEqual({ action: 'skip' });
  });

  it('paquete que ya salió a ruta → se conserva y se avisa (ya se trabajó)', () => {
    expect(decideMasterRemoval({ ...base, hasDispatch: true })).toEqual({
      action: 'keep',
      reason: 'ya salió a ruta como paquete',
    });
  });

  it('paquete con ingreso vivo → se conserva y se avisa', () => {
    expect(decideMasterRemoval({ ...base, hasActiveIncome: true })).toEqual({
      action: 'keep',
      reason: 'ya tiene ingreso como paquete',
    });
  });

  it('paquete entregado o devuelto → se conserva y se avisa', () => {
    expect(decideMasterRemoval({ ...base, status: 'devuelto_a_fedex' })).toEqual({
      action: 'keep',
      reason: 'ya está entregado o devuelto como paquete',
    });
  });
});
