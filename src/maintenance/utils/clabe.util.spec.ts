import { clabeCheckDigit, isValidClabe } from './clabe.util';

describe('CLABE', () => {
  // CLABE de ejemplo pública de Banxico: 002010077777777771 (DV 1).
  it('válida', () => expect(isValidClabe('002010077777777771')).toBe(true));
  it('dígito verificador calculado', () => expect(clabeCheckDigit('00201007777777777')).toBe(1));
  it('dígito verificador incorrecto', () => expect(isValidClabe('002010077777777772')).toBe(false));
  it('longitud incorrecta o letras', () => {
    expect(isValidClabe('12345')).toBe(false);
    expect(isValidClabe('00201007777777777A')).toBe(false);
  });
  it('acepta espacios', () => expect(isValidClabe('002 010 07777777777 1')).toBe(true));
});
