import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EmailLogService, EmailFile } from './email-log.service';
import { EmailStatus } from 'src/common/enums/email-status.enum';

/** Repo falso en memoria que cubre lo que usa EmailLogService. */
function makeRepo() {
  const rows: any[] = [];
  return {
    rows,
    create: (obj: any) => ({ ...obj }),
    save: async (arg: any) => {
      const list = Array.isArray(arg) ? arg : [arg];
      list.forEach((r) => rows.push(r));
      return arg;
    },
    find: async ({ where }: any) =>
      rows.filter((r) => r.module === where.module && r.entityId === where.entityId),
    delete: async (where: any) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].module === where.module && rows[i].entityId === where.entityId) rows.splice(i, 1);
      }
    },
  };
}

describe('EmailLogService (adjuntos en disco)', () => {
  let tmp: string;
  let cwdSpy: jest.SpyInstance;
  let logRepo: ReturnType<typeof makeRepo>;
  let attRepo: ReturnType<typeof makeRepo>;
  let svc: EmailLogService;

  const files: EmailFile[] = [
    { filename: 'ruta.pdf', content: Buffer.from('pdf-bytes'), mimeType: 'application/pdf' },
    { filename: 'ruta.xlsx', content: Buffer.from('xlsx-bytes') },
  ];

  beforeEach(async () => {
    tmp = await fs.mkdtemp(join(tmpdir(), 'emaillog-'));
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmp);
    logRepo = makeRepo();
    attRepo = makeRepo();
    svc = new EmailLogService(logRepo as any, attRepo as any);
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('persiste los adjuntos en disco y registra su ruta relativa', async () => {
    await svc.persistAttachments('package_dispatch', 'D1', files);

    expect(attRepo.rows).toHaveLength(2);
    const pdfRow = attRepo.rows.find((r) => r.filename === 'ruta.pdf');
    expect(pdfRow.storagePath).toBe(join('uploads', 'email', 'package_dispatch', 'D1', 'ruta.pdf'));
    // El archivo existe en disco con los bytes correctos.
    const onDisk = await fs.readFile(join(tmp, pdfRow.storagePath));
    expect(onDisk.toString()).toBe('pdf-bytes');
  });

  it('loadAttachments devuelve los archivos leídos del disco', async () => {
    await svc.persistAttachments('package_dispatch', 'D1', files);
    const loaded = await svc.loadAttachments('package_dispatch', 'D1');
    expect(loaded).not.toBeNull();
    expect(loaded).toHaveLength(2);
    expect(loaded!.find((f) => f.filename === 'ruta.pdf')!.content.toString()).toBe('pdf-bytes');
  });

  it('loadAttachments devuelve null cuando el archivo fue purgado del disco', async () => {
    await svc.persistAttachments('package_dispatch', 'D1', files);
    // Simula que el operador borró la carpeta con el tiempo.
    await fs.rm(join(tmp, 'uploads', 'email', 'package_dispatch', 'D1'), { recursive: true, force: true });

    const loaded = await svc.loadAttachments('package_dispatch', 'D1');
    expect(loaded).toBeNull();
  });

  it('loadAttachments devuelve null cuando no hay registros', async () => {
    expect(await svc.loadAttachments('package_dispatch', 'nope')).toBeNull();
  });

  it('persistAttachments es idempotente (no duplica registros al re-persistir)', async () => {
    await svc.persistAttachments('package_dispatch', 'D1', files);
    await svc.persistAttachments('package_dispatch', 'D1', files);
    expect(attRepo.rows).toHaveLength(2);
  });

  it('record serializa destinatarios y direcciones rechazadas', async () => {
    await svc.record({
      module: 'package_dispatch',
      entityId: 'D1',
      to: ['a@x.com', 'b@x.com'],
      cc: null,
      subject: 'S',
      status: EmailStatus.ERROR,
      rejected: ['b@x.com'],
    });
    expect(logRepo.rows).toHaveLength(1);
    expect(logRepo.rows[0].to).toBe('a@x.com, b@x.com');
    expect(logRepo.rows[0].rejected).toBe('b@x.com');
    expect(logRepo.rows[0].status).toBe(EmailStatus.ERROR);
  });

  it('record guarda el tipo, la sucursal, el folio y el usuario que lo realizó', async () => {
    await svc.record({
      module: 'package_dispatch',
      emailType: 'route_dispatch',
      entityId: 'D1',
      referenceTracking: 'FOLIO-99',
      subsidiaryId: 'S1',
      subsidiaryName: 'Cd. Obregón',
      to: 'a@x.com',
      subject: 'S',
      status: EmailStatus.SENT,
      triggeredById: 'U1',
      triggeredByName: 'María López',
    });
    const row = logRepo.rows[0];
    expect(row.emailType).toBe('route_dispatch');
    expect(row.referenceTracking).toBe('FOLIO-99');
    expect(row.subsidiaryName).toBe('Cd. Obregón');
    expect(row.triggeredByName).toBe('María López');
    expect(row.triggeredById).toBe('U1');
  });

  it('record usa emailType "unknown" cuando no se especifica', async () => {
    await svc.record({ module: 'm', entityId: 'e', to: 'a@x.com', subject: 'S', status: EmailStatus.SENT });
    expect(logRepo.rows[0].emailType).toBe('unknown');
  });
});
