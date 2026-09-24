import { toWhatsappNumber } from './whatsapp-number.util';

describe('toWhatsappNumber', () => {
  it('10 dígitos', () => expect(toWhatsappNumber('(662) 123-4567')).toBe('526621234567'));
  it('con 52', () => expect(toWhatsappNumber('+52 662 123 4567')).toBe('526621234567'));
  it('con 521', () => expect(toWhatsappNumber('5216621234567')).toBe('526621234567'));
  it('inválido', () => expect(toWhatsappNumber('123')).toBeNull());
});
