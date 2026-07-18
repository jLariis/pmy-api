import { WhatsappTemplatesController } from './whatsapp-templates.controller';

describe('WhatsappTemplatesController', () => {
  const svc: any = {
    list: jest.fn().mockResolvedValue([{ key: 'salida_ruta' }]),
    create: jest.fn().mockResolvedValue({ id: '1' }),
    update: jest.fn().mockResolvedValue({ id: '1', body: 'b' }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const ctrl = new WhatsappTemplatesController(svc);

  it('GET delega en list', async () => {
    expect(await ctrl.list()).toEqual([{ key: 'salida_ruta' }]);
  });
  it('PUT delega en update con id y body', async () => {
    await ctrl.update('1', { body: 'b' } as any);
    expect(svc.update).toHaveBeenCalledWith('1', { body: 'b' });
  });
});
