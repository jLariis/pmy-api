import { NotificationDispatchService } from './notification-dispatch.service';

function make() {
  const mailer: any = { sendMail: jest.fn(() => Promise.resolve()) };
  const wa: any = { sendText: jest.fn(() => Promise.resolve({ ok: true })) };
  const userRepo: any = {
    find: () => Promise.resolve([{ id: 'u1', email: 'u1@x.com', name: 'Uno' }]),
  };
  const svc = new NotificationDispatchService(mailer, wa, userRepo);
  return { svc, mailer, wa };
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
});
