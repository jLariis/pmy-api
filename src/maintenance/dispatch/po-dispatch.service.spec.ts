import { BadRequestException } from '@nestjs/common';
import { PoDispatchService, resolveDestination } from './po-dispatch.service';

const contactEmail = { id: 'c1', name: 'Juan', email: 'juan@taller.com', phone: '6621234567', whatsapp: null, preferredChannel: 'email', isDefault: true };
const contactWa = { id: 'c2', name: 'Ana', email: null, phone: null, whatsapp: '(662) 765-4321', preferredChannel: 'whatsapp', isDefault: false };

const order = (over: any = {}) => ({
  id: 'po1', folio: 'OC-000001', status: 'autorizada', subsidiaryId: 'sub1', total: 1160, contactId: 'c1',
  contact: contactEmail, supplier: { name: 'Taller X', contacts: [contactEmail, contactWa] },
  subsidiary: { name: 'Hermosillo', officeEmail: 'hmo@pmy.com' }, vehicle: { code: 'PMY13', plateNumber: 'UU-1' },
  items: [{ description: 'Balatas', quantity: 1, unitPrice: 1000, taxRate: 0.16, approved: true }],
  ...over,
});

function make(opts: { mailFails?: boolean; waFails?: boolean } = {}) {
  const saved: any[] = [];
  const orders: any = { update: jest.fn(async () => undefined) };
  const dispatches: any = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => { saved.push(x); return x; }),
    find: jest.fn(async () => []),
  };
  const templates: any = { render: jest.fn(async () => ({ buffer: Buffer.from('%PDF') })) };
  const branding: any = { getTokens: jest.fn(async () => ({ fiscal: { razonSocial: 'PMY SA' } })) };
  const mail: any = {
    sendPurchaseOrderEmail: jest.fn(async () => {
      if (opts.mailFails) throw new Error('SMTP caído');
      return { to: 'juan@taller.com', cc: 'hmo@pmy.com', subject: 's', accepted: [], rejected: [], messageId: 'm1' };
    }),
  };
  const emailLog: any = { persistAttachments: jest.fn(async () => undefined), record: jest.fn(async () => ({ id: 'log1' })) };
  const whatsapp: any = {
    sendDocument: jest.fn(async () => { if (opts.waFails) throw new Error('WhatsApp no está conectado'); return { ok: true }; }),
    sendText: jest.fn(async () => ({ ok: true })),
  };
  const svc = new PoDispatchService(orders, dispatches, templates, branding, mail, emailLog, whatsapp);
  return { svc, saved, orders, mail, emailLog, whatsapp };
}

const user = { userId: 'u1', name: 'Laura', role: 'admin' };

describe('resolveDestination', () => {
  it('correo y WhatsApp normalizado', () => {
    expect(resolveDestination(contactEmail as any, 'email')).toBe('juan@taller.com');
    expect(resolveDestination(contactWa as any, 'whatsapp')).toBe('526627654321');
  });
  it('sin dato para el canal → 400', () => {
    expect(() => resolveDestination(contactWa as any, 'email')).toThrow(BadRequestException);
    expect(() => resolveDestination(null, 'email')).toThrow(BadRequestException);
  });
});

describe('PoDispatchService.send', () => {
  it('no envía órdenes sin autorizar', async () => {
    await expect(make().svc.send(order({ status: 'pendiente' }) as any, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('correo OK → bitácora, intento "enviado" y orden "enviada"', async () => {
    const { svc, saved, orders, emailLog } = make();
    const r = await svc.send(order() as any, user);
    expect(r).toEqual({ channel: 'email', destination: 'juan@taller.com' });
    expect(emailLog.record).toHaveBeenCalledWith(expect.objectContaining({ module: 'purchase_order', status: 'sent' }));
    expect(saved[0]).toMatchObject({ status: 'enviado', channel: 'email', emailLogId: 'log1' });
    expect(orders.update).toHaveBeenCalledWith('po1', expect.objectContaining({ status: 'enviada' }));
  });

  it('WhatsApp falla → intento "error" y la orden NO cambia de estado', async () => {
    const { svc, saved, orders } = make({ waFails: true });
    await expect(svc.send(order() as any, user, { channel: 'whatsapp', contactId: 'c2' })).rejects.toThrow(/Puedes intentar por correo/);
    expect(saved[0]).toMatchObject({ status: 'error', channel: 'whatsapp', destination: '526627654321' });
    expect(orders.update).not.toHaveBeenCalled();
  });

  it('correo falla → bitácora con error', async () => {
    const { svc, emailLog } = make({ mailFails: true });
    await expect(svc.send(order() as any, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(emailLog.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });
});
