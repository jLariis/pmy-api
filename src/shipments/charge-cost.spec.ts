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
});
