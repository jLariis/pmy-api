import { resolveChargeCost, chargeSecondAbordApplied, chargeDayRangeUtc, shouldSkipSameDayCharge } from './charge-cost';

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

  describe('override de segundo abordo (alta F2)', () => {
    const sub = { chargeCost: 4878, chargeSecondAbord: false, secondAbordAmount: 597 };

    it('override=true suma aunque la sucursal lo tenga apagado', () => {
      expect(resolveChargeCost(sub, false, false, true)).toBe(5475);
    });
    it('override=false NO suma aunque la sucursal lo tenga prendido', () => {
      expect(resolveChargeCost({ ...sub, chargeSecondAbord: true }, false, false, false)).toBe(4878);
    });
    it('override undefined cae al default de la sucursal', () => {
      expect(resolveChargeCost({ ...sub, chargeSecondAbord: true }, false, false)).toBe(5475);
    });
  });

  describe('chargeSecondAbordApplied', () => {
    it('true cuando el override lo prende sobre base normal', () => {
      expect(chargeSecondAbordApplied({ chargeCost: 4878, chargeSecondAbord: false }, false, false, true)).toBe(true);
    });
    it('false sobre base 1.5 ton aunque esté prendido', () => {
      expect(chargeSecondAbordApplied({ chargeCost: 4878, chargeCostHalfTon: 4228, chargeSecondAbord: true }, true, false)).toBe(false);
    });
    it('false sobre sobreprecio domingo/festivo', () => {
      expect(chargeSecondAbordApplied({ chargeCost: 4878, chargeCostSundayHoliday: 6660, chargeSecondAbord: true }, false, true)).toBe(false);
    });
  });
});

describe('regla "solo la primera carga del día"', () => {
  describe('chargeDayRangeUtc', () => {
    it('acota al día calendario UTC de la fecha del consolidado (rango [inicio, +1 día))', () => {
      const { dayStart, dayEnd } = chargeDayRangeUtc(new Date('2026-09-18T00:00:00.000Z'));
      expect(dayStart.toISOString()).toBe('2026-09-18T00:00:00.000Z');
      expect(dayEnd.toISOString()).toBe('2026-09-19T00:00:00.000Z');
    });

    it('normaliza cualquier instante del día al mismo rango (no importa la hora)', () => {
      const { dayStart, dayEnd } = chargeDayRangeUtc(new Date('2026-09-18T23:59:59.000Z'));
      expect(dayStart.toISOString()).toBe('2026-09-18T00:00:00.000Z');
      expect(dayEnd.toISOString()).toBe('2026-09-19T00:00:00.000Z');
    });

    it('fecha inválida cae al día de hoy sin reventar', () => {
      const { dayStart, dayEnd } = chargeDayRangeUtc(new Date('no-es-fecha'));
      expect(dayEnd.getTime() - dayStart.getTime()).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('shouldSkipSameDayCharge', () => {
    it('la PRIMERA carga del día cobra normal (no hay otra hoy)', () => {
      expect(shouldSkipSameDayCharge(true, false)).toBe(false);
    });
    it('la 2ª+ carga del día se registra en $0 cuando el flag está activo', () => {
      expect(shouldSkipSameDayCharge(true, true)).toBe(true);
    });
    it('con el flag apagado NUNCA se salta el cobro, aunque ya haya cargas hoy', () => {
      expect(shouldSkipSameDayCharge(false, true)).toBe(false);
      expect(shouldSkipSameDayCharge(false, false)).toBe(false);
    });
  });
});
