import { promises as fs } from 'fs';
import { join } from 'path';
import { ImportFilesService } from './import-files.service';

function repoMock() {
  const store: any[] = [];
  return {
    store,
    create: (x: any) => ({ ...x }),
    save: async (x: any) => { const row = { id: 'imp-1', createdAt: new Date(), ...x }; store.push(row); return row; },
    find: async () => store,
    findOne: async ({ where }: any) => store.find((r) => r.id === where.id) ?? null,
  } as any;
}
// Consolidated repo that returns a match so consolidatedId gets resolved.
function consRepoMock(id: string | null) {
  return { findOne: async () => (id ? { id } : null) } as any;
}

describe('ImportFilesService.persist', () => {
  it('writes the buffer to disk and stores metadata with resolved consolidatedId', async () => {
    const importRepo = repoMock();
    const svc = new ImportFilesService(importRepo, consRepoMock('cons-9'));
    const row = await svc.persist(
      { originalname: 'aereo.xlsx', buffer: Buffer.from('hello'), mimetype: 'application/vnd.ms-excel' },
      { kind: 'master', subsidiaryId: 'sub-1', consNumber: 'CONS-1', rowCount: 3, uploadedById: 'u1', uploadedByName: 'Ada' },
    );
    expect(row.originalName).toBe('aereo.xlsx');
    expect(row.size).toBe(5);
    expect(row.consolidatedId).toBe('cons-9');
    expect(row.kind).toBe('master');
    const abs = join(process.cwd(), row.storagePath);
    const content = await fs.readFile(abs);
    expect(content.toString()).toBe('hello');
    await fs.rm(join(process.cwd(), 'uploads', 'imports', 'fedex'), { recursive: true, force: true });
  });
});
