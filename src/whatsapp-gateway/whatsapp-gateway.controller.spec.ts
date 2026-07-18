import { BadRequestException } from '@nestjs/common';
import { WhatsappGatewayController } from './whatsapp-gateway.controller';

describe('WhatsappGatewayController.send', () => {
  const gateway: any = { sendText: jest.fn().mockResolvedValue({ ok: true }) };
  const ctrl = new WhatsappGatewayController(gateway);

  it('sin to lanza 400', async () => {
    await expect(ctrl.send({ message: 'hola' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('con to delega en sendText con solo dígitos', async () => {
    await ctrl.send({ message: 'hola', to: '+52 (644) 423-0374' } as any);
    expect(gateway.sendText).toHaveBeenCalledWith('526444230374', 'hola');
  });
});
