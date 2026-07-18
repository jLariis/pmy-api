import { Repository } from 'typeorm';
import { WhatsappTemplate } from 'src/entities';
import { WHATSAPP_TEMPLATE_DEFAULTS } from './whatsapp-template-defaults';

/** Inserta solo las claves que falten (no pisa ediciones del usuario). */
export async function seedWhatsappTemplates(repo: Repository<WhatsappTemplate>): Promise<void> {
  for (const def of WHATSAPP_TEMPLATE_DEFAULTS) {
    const existing = await repo.findOne({ where: { key: def.key } });
    if (!existing) {
      await repo.save(repo.create({ key: def.key, name: def.name, body: def.body, active: true, updatedAt: new Date() }));
    }
  }
}
