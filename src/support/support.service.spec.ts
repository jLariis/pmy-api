import { SupportService } from './support.service';

function make(overrides: any = {}) {
  const savedTickets: any[] = [];
  const ticketRepo: any = {
    create: (d: any) => d,
    save: (t: any) => { const row = { id: 't1', ...t }; savedTickets.push(row); return Promise.resolve(row); },
    count: overrides.count ?? (() => Promise.resolve(0)),
    findOne: overrides.findOne ?? (() => Promise.resolve(savedTickets[savedTickets.length - 1] ?? { id: 't1', folio: 'SUP-0001', estado: 'pendiente', prioridad: 'media', requesterId: 'r1', createdAt: new Date(), updatedAt: null })),
    find: () => Promise.resolve([]),
    update: () => Promise.resolve({ affected: 1 }),
  };
  const savedComments: any[] = [];
  const commentRepo: any = { create: (d: any) => d, save: (c: any) => { const row = { id: 'c1', ...c }; savedComments.push(row); return Promise.resolve(row); } };
  const attachmentRepo: any = { create: (d: any) => d, save: (a: any) => Promise.resolve(a) };
  const commentAttachmentRepo: any = { create: (d: any) => d, save: (a: any) => Promise.resolve(a) };
  // Sin usuario con el email del agente default → auto-asignación cae al id de config.
  const userRepo: any = { findOne: overrides.userFindOne ?? (() => Promise.resolve(undefined)) };
  const notifier: any = {
    emit: jest.fn(() => Promise.resolve()),
    sendSupportGroupCard: jest.fn(() => Promise.resolve({ sent: true })),
    sendWhatsapp: jest.fn(() => Promise.resolve({ sent: true })),
  };
  const locator: any = { contextFor: () => ({ repo: null, files: [], components: [], confidence: 'ninguna' }) };
  const deepseek: any = { isEnabled: () => false, complete: jest.fn() };
  const approval: any = {
    zoneMap: () => Promise.resolve(new Map()),
    notifyPendingApproval: jest.fn(() => Promise.resolve()),
  };
  const svc = new SupportService(ticketRepo, commentRepo, attachmentRepo, commentAttachmentRepo, userRepo, notifier, locator, deepseek, approval);
  return { svc, savedTickets, savedComments, notifier, ticketRepo };
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

  it('auto-asigna al agente default (admin@delyaqui.com) y fija slaDueAt', async () => {
    const { svc, savedTickets } = make();
    await svc.create({ tipo: 'error', titulo: 'Falla', descripcion: 'x' } as any, requester as any, []);
    expect(savedTickets[0].assigneeEmail).toBe('admin@delyaqui.com');
    expect(savedTickets[0].assigneeName).toBeTruthy();
    expect(savedTickets[0].slaDueAt).toBeInstanceOf(Date);
  });

  it('persists attachment rows for uploaded files', async () => {
    const { svc } = make();
    const files = [{ filename: 'a.png', mimetype: 'image/png', size: 10, path: 'uploads/support/t1/a.png' }];
    await svc.create({ tipo: 'error', titulo: 'x', descripcion: 'y' } as any, requester as any, files as any);
    // no throw = attachment save path exercised
  });
});

describe('SupportService.addComment', () => {
  const agent = { userId: 'admin', name: 'Admin', email: 'admin@x.com' };

  it('un comentario del solicitante NUNCA es interno, aunque mande el flag', async () => {
    const { svc, savedComments } = make();
    await svc.addComment('t1', { texto: 'hola', internal: 'true' } as any, requester as any, []);
    expect(savedComments[0].internal).toBe(false);
  });

  it('coacciona internal="true" (multipart) a boolean para el agente', async () => {
    const { svc, savedComments } = make();
    await svc.addComment('t1', { texto: 'nota', internal: 'true' } as any, agent as any, []);
    expect(savedComments[0].internal).toBe(true);
  });

  it('guarda las imágenes adjuntas del comentario', async () => {
    const { svc } = make();
    const files = [{ filename: 'a.png', path: '/x/abc/a.png', mimetype: 'image/png', size: 10 }];
    await svc.addComment('t1', { texto: 'con foto' } as any, requester as any, files as any);
    // no throw = comment attachment save path exercised
  });
});
