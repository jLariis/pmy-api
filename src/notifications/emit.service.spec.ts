import { NotificationsService } from './notifications.service';

function make(overrides: any = {}) {
  const saved: any[] = [];
  const notifRepo: any = {
    create: (d: any) => d,
    save: (rows: any[]) => { saved.push(...rows); return Promise.resolve(rows); },
  };
  const userRepo: any = {
    find: overrides.userFind ?? (() => Promise.resolve([{ id: 'u1' }, { id: 'u2' }, { id: 'actor' }])),
  };
  const readRepo: any = {};
  const auditRepo: any = {};
  const dispatch: any = { deliver: jest.fn(() => Promise.resolve()) };
  const svc = new NotificationsService(auditRepo, readRepo, notifRepo, userRepo, dispatch);
  return { svc, saved, dispatch, userRepo };
}

describe('NotificationsService.emit', () => {
  it('fans out a subsidiary broadcast to one row per user, excluding the actor', async () => {
    const { svc, saved } = make();
    await svc.emit({
      type: 'operacion.consolidados',
      audience: { subsidiaryId: 's1' },
      title: 'Consolidado',
      body: 'Registró consolidado C-1',
      actor: { id: 'actor', name: 'Ana' },
    });
    expect(saved.map((r) => r.recipientId).sort()).toEqual(['u1', 'u2']);
    expect(saved[0].type).toBe('operacion.consolidados');
    expect(saved[0].icon).toBe('bell'); // default presentation
  });

  it('targets a single user directly', async () => {
    const { svc, saved } = make();
    await svc.emit({ type: 'ticket.asignado', audience: { userId: 'dev1' }, title: 'Asignado' });
    expect(saved).toHaveLength(1);
    expect(saved[0].recipientId).toBe('dev1');
    expect(saved[0].category).toBe('soporte');
  });

  it('does NOT exclude the actor for a direct target (self-assignment still notifies)', async () => {
    const { svc, saved } = make();
    await svc.emit({ type: 'ticket.asignado', audience: { userId: 'actor' }, title: 'Asignado', actor: { id: 'actor', name: 'Yo' } });
    expect(saved).toHaveLength(1);
    expect(saved[0].recipientId).toBe('actor');
  });

  it('never throws even if persistence fails', async () => {
    const { svc } = make();
    (svc as any).notifRepo.save = () => Promise.reject(new Error('db down'));
    await expect(svc.emit({ type: 'x', audience: { userId: 'u1' }, title: 't' })).resolves.toBeUndefined();
  });
});
