import { seedWhatsappTemplates } from './whatsapp-templates.seed';
import { WHATSAPP_TEMPLATE_DEFAULTS } from './whatsapp-template-defaults';

describe('seedWhatsappTemplates', () => {
  it('inserta claves faltantes y no duplica existentes', async () => {
    const rows: any[] = [{ id: 'pe', key: 'prioridad_entrega', name: 'x', body: 'EDITADO', active: true }];
    const repo: any = {
      findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.key === where.key) ?? null),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => { x.id = x.id ?? 'n' + rows.length; rows.push(x); return x; }),
    };
    await seedWhatsappTemplates(repo);
    // no pisó la editada
    expect(rows.find((r) => r.key === 'prioridad_entrega').body).toBe('EDITADO');
    // insertó las otras 4
    expect(rows.length).toBe(WHATSAPP_TEMPLATE_DEFAULTS.length);
  });
});
