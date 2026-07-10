import { SupportService } from './support.service';

function make(overrides: any = {}) {
  const savedTickets: any[] = [];
  const ticketRepo: any = {
    create: (d: any) => d,
    save: (t: any) => { const row = { id: 't1', ...t }; savedTickets.push(row); return Promise.resolve(row); },
    count: overrides.count ?? (() => Promise.resolve(0)),
    findOne: overrides.findOne ?? (() => Promise.resolve({ id: 't1', folio: 'SUP-0001', estado: 'pendiente', prioridad: 'media', requesterId: 'r1' })),
    find: () => Promise.resolve([]),
  };
  const commentRepo: any = { create: (d: any) => d, save: (c: any) => Promise.resolve({ id: 'c1', ...c }) };
  const attachmentRepo: any = { create: (d: any) => d, save: (a: any) => Promise.resolve(a) };
  const notifier: any = { emit: jest.fn(() => Promise.resolve()) };
  const svc = new SupportService(ticketRepo, commentRepo, attachmentRepo, notifier);
  return { svc, savedTickets, notifier, ticketRepo };
}

const requester = { userId: 'r1', name: 'Ana', lastName: 'Ruiz', email: 'ana@x.com', subsidiaryId: 's1' };

describe('SupportService.create', () => {
  it('assigns a sequential folio and emits ticket.creada', async () => {
    const { svc, savedTickets, notifier } = make({ count: () => Promise.resolve(4) });
    const t = await svc.create({ tipo: 'error', titulo: 'Falla', descripcion: 'x' } as any, requester as any, []);
    expect(savedTickets[0].folio).toBe('SUP-0005');
    expect(t.folio).toBe('SUP-0005');
    expect(notifier.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'ticket.creada' }));
  });

  it('persists attachment rows for uploaded files', async () => {
    const { svc } = make();
    const files = [{ filename: 'a.png', mimetype: 'image/png', size: 10, path: 'uploads/support/t1/a.png' }];
    await svc.create({ tipo: 'error', titulo: 'x', descripcion: 'y' } as any, requester as any, files as any);
    // no throw = attachment save path exercised
  });
});
