import { BadRequestException } from '@nestjs/common';
import { normalizeContacts } from './supplier-contacts.util';

const c = (over: any = {}) => ({ name: 'Juan', preferredChannel: 'email', email: 'j@x.com', ...over });

describe('normalizeContacts', () => {
  it('sin predeterminado → el primero', () => {
    const r = normalizeContacts([c(), c({ name: 'Ana' })] as any);
    expect(r.map((x) => x.isDefault)).toEqual([true, false]);
  });

  it('varios predeterminados → solo el primero marcado', () => {
    const r = normalizeContacts([c(), c({ isDefault: true }), c({ isDefault: true })] as any);
    expect(r.map((x) => x.isDefault)).toEqual([false, true, false]);
  });

  it('correo predeterminado sin correo → error', () => {
    expect(() => normalizeContacts([c({ email: '' })] as any)).toThrow(BadRequestException);
  });

  it('WhatsApp predeterminado usa whatsapp o teléfono', () => {
    expect(() => normalizeContacts([c({ preferredChannel: 'whatsapp', whatsapp: '', phone: '6621234567' })] as any)).not.toThrow();
    expect(() => normalizeContacts([c({ preferredChannel: 'whatsapp', whatsapp: '123', phone: '' })] as any)).toThrow(BadRequestException);
  });
});
