import { amountToWordsMXN } from './amount-to-words.util';

describe('amountToWordsMXN', () => {
  it('1200.50', () => expect(amountToWordsMXN(1200.5)).toBe('MIL DOSCIENTOS PESOS 50/100 M.N.'));
  it('1', () => expect(amountToWordsMXN(1)).toBe('UN PESO 00/100 M.N.'));
  it('21,345.07', () => expect(amountToWordsMXN(21345.07)).toBe('VEINTIÚN MIL TRESCIENTOS CUARENTA Y CINCO PESOS 07/100 M.N.'));
  it('1,000,000', () => expect(amountToWordsMXN(1000000)).toBe('UN MILLÓN DE PESOS 00/100 M.N.'));
});
