import { NotificationDispatchService } from './notification-dispatch.service';

function make() {
  const mailer: any = { sendMail: jest.fn(() => Promise.resolve()) };
  const wa: any = {
    sendText: jest.fn(() => Promise.resolve({ ok: true })),
    getStatus: jest.fn(() => ({ status: 'connected', me: '52...', qr: null, lastError: null })),
    findGroupJid: jest.fn(() => Promise.resolve('123@g.us')),
    sendImage: jest.fn(() => Promise.resolve({ ok: true })),
  };
  const userRepo: any = {
    find: () => Promise.resolve([{ id: 'u1', email: 'u1@x.com', name: 'Uno' }]),
  };
  const templates: any = { render: jest.fn(() => Promise.resolve({ subject: 'S', html: '<p>x</p>' })) };
  const svc = new NotificationDispatchService(mailer, wa, userRepo, templates);
  return { svc, mailer, wa, templates };
}

describe('NotificationDispatchService.deliver', () => {
  it('sends email when channel includes email', async () => {
    const { svc, mailer } = make();
    await svc.deliver({ type: 'ticket.estado', audience: { userId: 'u1' }, title: 'Actualizado', body: 'Resuelto' } as any, ['u1'], ['bell', 'email']);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
  });

  it('does not send email when only bell', async () => {
    const { svc, mailer } = make();
    await svc.deliver({ type: 'operacion.x', audience: { subsidiaryId: 's' }, title: 't' } as any, ['u1'], ['bell']);
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('never throws when a channel fails', async () => {
    const { svc, mailer } = make();
    mailer.sendMail = () => Promise.reject(new Error('smtp down'));
    await expect(svc.deliver({ type: 't', audience: { userId: 'u1' }, title: 't' } as any, ['u1'], ['email'])).resolves.toBeUndefined();
  });

  it('never throws when templates.render rejects', async () => {
    const { svc, templates, mailer } = make();
    templates.render = jest.fn(() => Promise.reject(new Error('render blew up')));
    await expect(svc.deliver({ type: 't', audience: { userId: 'u1' }, title: 't' } as any, ['u1'], ['email'])).resolves.toBeUndefined();
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationDispatchService.channelHealth / sendTest', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });

  it('bell siempre listo; email según env; whatsapp según gateway + número', () => {
    process.env.EMAIL_SERVICE_HOST = 'smtp.x';
    process.env.EMAIL_SERVICE_EMAIL = 'a@x.com';
    process.env.EMAIL_SERVICE_PASSWORD = 'p';
    process.env.SUPPORT_WHATSAPP = '52999';
    const { svc } = make();
    const h = svc.channelHealth();
    expect(h.bell.ready).toBe(true);
    expect(h.email.ready).toBe(true);
    expect(h.whatsapp.ready).toBe(true);
  });

  it('email no listo si falta env; whatsapp no listo si falta número', () => {
    delete process.env.EMAIL_SERVICE_HOST;
    delete process.env.SUPPORT_WHATSAPP;
    const { svc } = make();
    const h = svc.channelHealth();
    expect(h.email.ready).toBe(false);
    expect(h.whatsapp.ready).toBe(false); // conectado pero sin número destino
  });

  it('sendTest reporta por canal (email ok, whatsapp ok)', async () => {
    process.env.SUPPORT_WHATSAPP = '52999';
    const { svc, mailer, wa } = make();
    const r = await svc.sendTest({ email: 'u1@x.com' });
    expect(r.email.sent).toBe(true);
    expect(r.whatsapp.sent).toBe(true);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(wa.sendText).toHaveBeenCalledTimes(1);
  });

  it('sendTest captura el fallo de un canal sin lanzar', async () => {
    process.env.SUPPORT_WHATSAPP = '52999';
    const { svc, wa } = make();
    wa.sendText = jest.fn(() => Promise.reject(new Error('no conectado')));
    const r = await svc.sendTest({ email: null });
    expect(r.email.sent).toBe(false);
    expect(r.whatsapp.sent).toBe(false);
    expect(r.whatsapp.error).toContain('no conectado');
  });
});

describe('NotificationDispatchService.sendGroupCard', () => {
  it('con imagen → manda sendImage con el texto como caption', async () => {
    const { svc, wa } = make();
    const r = await svc.sendGroupCard('Sistemas PMY', 'hola', '/x/a.png');
    expect(r.sent).toBe(true);
    expect(wa.sendImage).toHaveBeenCalledWith('123@g.us', '/x/a.png', 'hola');
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it('si la imagen falla, cae a solo texto', async () => {
    const { svc, wa } = make();
    wa.sendImage = jest.fn(() => Promise.reject(new Error('media fail')));
    const r = await svc.sendGroupCard('Sistemas PMY', 'hola', '/x/a.png');
    expect(r.sent).toBe(true);
    expect(wa.sendText).toHaveBeenCalledTimes(1);
  });

  it('sin imagen → manda texto', async () => {
    const { svc, wa } = make();
    const r = await svc.sendGroupCard('Sistemas PMY', 'hola');
    expect(r.sent).toBe(true);
    expect(wa.sendText).toHaveBeenCalledTimes(1);
    expect(wa.sendImage).not.toHaveBeenCalled();
  });

  it('grupo no encontrado → sent:false, no lanza', async () => {
    const { svc, wa } = make();
    wa.findGroupJid = jest.fn(() => Promise.resolve(null));
    const r = await svc.sendGroupCard('Inexistente', 'hola', '/x/a.png');
    expect(r.sent).toBe(false);
    expect(wa.sendImage).not.toHaveBeenCalled();
    expect(wa.sendText).not.toHaveBeenCalled();
  });
});
