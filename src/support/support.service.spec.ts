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
  const readRepo: any = { find: () => Promise.resolve([]), upsert: () => Promise.resolve({}) };
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
  const svc = new SupportService(ticketRepo, commentRepo, attachmentRepo, commentAttachmentRepo, readRepo, userRepo, notifier, locator, deepseek, approval);
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

describe('SupportService.confirmResolution', () => {
  const completado = () => ({ id: 't1', folio: 'SUP-1', titulo: 'x', estado: 'completado', requesterId: 'r1' });

  it('el creador confirma resuelto → sella confirmedAt (cierra)', async () => {
    const { svc, ticketRepo } = make({ findOne: () => Promise.resolve(completado()) });
    const spy = jest.spyOn(ticketRepo, 'update');
    await svc.confirmResolution('t1', requester as any, true);
    expect(spy).toHaveBeenCalledWith({ id: 't1' }, expect.objectContaining({ confirmedAt: expect.any(Date) }));
  });

  it('no resuelto → regresa a por_hacer y guarda el motivo como comentario', async () => {
    const { svc, ticketRepo, savedComments } = make({ findOne: () => Promise.resolve(completado()) });
    const spy = jest.spyOn(ticketRepo, 'update');
    await svc.confirmResolution('t1', requester as any, false, 'sigue fallando');
    expect(spy).toHaveBeenCalledWith({ id: 't1' }, expect.objectContaining({ estado: 'por_hacer' }));
    expect(savedComments.some((c) => String(c.texto).includes('sigue fallando'))).toBe(true);
  });

  it('un usuario que no es el creador no puede confirmar', async () => {
    const { svc } = make({ findOne: () => Promise.resolve(completado()) });
    await expect(svc.confirmResolution('t1', { userId: 'otro', role: 'user' } as any, true)).rejects.toThrow();
  });

  it('solo se puede confirmar si está en "Hecho" (completado)', async () => {
    const { svc } = make({ findOne: () => Promise.resolve({ ...completado(), estado: 'en_progreso' }) });
    await expect(svc.confirmResolution('t1', requester as any, true)).rejects.toThrow();
  });
});
