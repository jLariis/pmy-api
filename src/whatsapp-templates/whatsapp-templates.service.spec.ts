import { WhatsappTemplatesService } from './whatsapp-templates.service';

function makeRepoMock(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    find: jest.fn().mockImplementation(async () => rows),
    findOne: jest.fn().mockImplementation(async ({ where }: any) => rows.find((r) => r.key === where.key || r.id === where.id) ?? null),
    create: jest.fn().mockImplementation((x: any) => ({ ...x })),
    save: jest.fn().mockImplementation(async (x: any) => { if (!x.id) x.id = 'id-' + rows.length; const i = rows.findIndex((r) => r.id === x.id); if (i >= 0) rows[i] = x; else rows.push(x); return x; }),
    delete: jest.fn().mockImplementation(async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); }),
  } as any;
}

describe('WhatsappTemplatesService', () => {
  it('update sella updatedAt y persiste el body', async () => {
    const repo = makeRepoMock([{ id: 'a', key: 'x', name: 'X', body: 'old', active: true }]);
    const svc = new WhatsappTemplatesService(repo);
    const r = await svc.update('a', { body: 'new' });
    expect(r.body).toBe('new');
    expect(r.updatedAt).toBeInstanceOf(Date);
  });
});
