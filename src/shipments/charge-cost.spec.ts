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

  describe('segundo abordo (chargeSecondAbord)', () => {
    it('suma secondAbordAmount al costo NORMAL cuando el flag está activo', () => {
      expect(
        resolveChargeCost({ chargeCost: 4878, chargeSecondAbord: true, secondAbordAmount: 597 }, false, false),
      ).toBe(5475);
    });

    it('NO suma si el flag está apagado', () => {
      expect(
        resolveChargeCost({ chargeCost: 4878, chargeSecondAbord: false, secondAbordAmount: 597 }, false, false),
      ).toBe(4878);
    });

    it('NO se apila sobre la base de 1.5 ton', () => {
      expect(
        resolveChargeCost({ chargeCost: 4878, chargeCostHalfTon: 4228, chargeSecondAbord: true, secondAbordAmount: 597 }, true, false),
      ).toBe(4228);
    });

    it('NO se apila sobre el sobreprecio domingo/festivo (F2)', () => {
      expect(
        resolveChargeCost({ chargeCost: 4878, chargeCostSundayHoliday: 6660, chargeSecondAbord: true, secondAbordAmount: 597 }, false, true),
      ).toBe(6660);
    });

    it('NO se apila sobre el sobreprecio domingo/festivo (1.5 ton)', () => {
      expect(
        resolveChargeCost({ chargeCost: 4878, chargeCostHalfTon: 4228, chargeCostHalfTonSundayHoliday: 6004, chargeSecondAbord: true, secondAbordAmount: 597 }, true, true),
      ).toBe(6004);
    });

    it('flag activo pero monto 0 es no-op', () => {
      expect(
        resolveChargeCost({ chargeCost: 4878, chargeSecondAbord: true, secondAbordAmount: 0 }, false, false),
      ).toBe(4878);
    });

    it('maneja secondAbordAmount como string (decimal de MySQL)', () => {
      expect(
        resolveChargeCost({ chargeCost: '4878.00', chargeSecondAbord: true, secondAbordAmount: '597.00' }, false, false),
      ).toBe(5475);
    });
  });
});
