import { computeSecondAbordDelta } from './second-abord.util';

describe('computeSecondAbordDelta', () => {
  it('quita el 2º a bordo cuando está incluido', () => {
    expect(computeSecondAbordDelta(4594, 594, false, true)).toBe(4000);
  });
  it('pone el 2º a bordo cuando no está incluido', () => {
    expect(computeSecondAbordDelta(4000, 594, true, false)).toBe(4594);
  });
  it('es idempotente: poner cuando ya incluido no dobla', () => {
    expect(computeSecondAbordDelta(4594, 594, true, true)).toBe(4594);
  });
  it('es idempotente: quitar cuando no incluido no baja', () => {
    expect(computeSecondAbordDelta(4000, 594, false, false)).toBe(4000);
  });
  it('nunca baja de 0', () => {
    expect(computeSecondAbordDelta(100, 594, false, true)).toBe(0);
  });
});
