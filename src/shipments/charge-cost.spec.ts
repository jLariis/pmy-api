import { resolveChargeCost } from './charge-cost';

describe('resolveChargeCost (carga 1.5 toneladas)', () => {
  it('usa chargeCostHalfTon cuando isHalfTon y la sucursal lo tiene configurado', () => {
    expect(resolveChargeCost({ chargeCost: 1200, chargeCostHalfTon: 3900 }, true)).toBe(3900);
  });

  it('cae al chargeCost normal cuando isHalfTon pero la sucursal no tiene costo 1.5 ton (0)', () => {
    expect(resolveChargeCost({ chargeCost: 1200, chargeCostHalfTon: 0 }, true)).toBe(1200);
  });

  it('usa chargeCost normal cuando isHalfTon está apagado, aunque exista chargeCostHalfTon', () => {
    expect(resolveChargeCost({ chargeCost: 1200, chargeCostHalfTon: 3900 }, false)).toBe(1200);
  });

  it('maneja valores string (decimales de MySQL) correctamente', () => {
    expect(resolveChargeCost({ chargeCost: '1200.00', chargeCostHalfTon: '3900.00' }, true)).toBe(3900);
    expect(resolveChargeCost({ chargeCost: '1200.00', chargeCostHalfTon: '0.00' }, true)).toBe(1200);
  });

  it('devuelve 0 ante valores nulos/indefinidos', () => {
    expect(resolveChargeCost({ chargeCost: null, chargeCostHalfTon: null }, true)).toBe(0);
    expect(resolveChargeCost({}, false)).toBe(0);
  });

  describe('sobreprecio domingo/festivo', () => {
    const hmo = {
      chargeCost: 4440,
      chargeCostHalfTon: 4228,
      chargeCostSundayHoliday: 6660,
      chargeCostHalfTonSundayHoliday: 6004,
    };

    it('carga normal (F2) en domingo/festivo usa chargeCostSundayHoliday', () => {
      expect(resolveChargeCost(hmo, false, true)).toBe(6660);
    });

    it('carga 1.5 ton en domingo/festivo usa chargeCostHalfTonSundayHoliday', () => {
      expect(resolveChargeCost(hmo, true, true)).toBe(6004);
    });

    it('en día normal (no domingo/festivo) usa la base aunque haya sobreprecio', () => {
      expect(resolveChargeCost(hmo, false, false)).toBe(4440);
      expect(resolveChargeCost(hmo, true, false)).toBe(4228);
    });

    it('sin sobreprecio configurado (0), domingo/festivo cae a la base', () => {
      expect(resolveChargeCost({ chargeCost: 1200, chargeCostHalfTon: 3900 }, false, true)).toBe(1200);
      expect(resolveChargeCost({ chargeCost: 1200, chargeCostHalfTon: 3900 }, true, true)).toBe(3900);
    });

    it('maneja el sobreprecio como string (decimal de MySQL)', () => {
      expect(resolveChargeCost({ chargeCost: '4440.00', chargeCostSundayHoliday: '6660.00' }, false, true)).toBe(6660);
    });
  });
});
