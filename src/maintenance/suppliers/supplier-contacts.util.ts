import { BadRequestException } from '@nestjs/common';
import { toWhatsappNumber } from '../utils/whatsapp-number.util';
import { ContactDto } from './dto/supplier.dto';

/**
 * Deja exactamente UN contacto predeterminado (el primero marcado, o el primero de la lista) y
 * valida que cada contacto tenga dato válido para su medio predeterminado.
 */
export function normalizeContacts(contacts: ContactDto[]): ContactDto[] {
  const firstDefault = contacts.findIndex((c) => c.isDefault);
  const defaultIdx = firstDefault >= 0 ? firstDefault : 0;
  return contacts.map((c, i) => {
    if (c.preferredChannel === 'email' && !c.email?.trim()) {
      throw new BadRequestException(`El contacto "${c.name}" no tiene correo y su medio predeterminado es correo.`);
    }
    if (c.preferredChannel === 'whatsapp' && !toWhatsappNumber(c.whatsapp || c.phone)) {
      throw new BadRequestException(`El contacto "${c.name}" no tiene un WhatsApp válido (10 dígitos) y su medio predeterminado es WhatsApp.`);
    }
    return { ...c, email: c.email?.trim() || null, isDefault: i === defaultIdx };
  });
}
