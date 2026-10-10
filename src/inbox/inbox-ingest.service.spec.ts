import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { InboxIngestService } from './inbox-ingest.service';
import { CABORCA } from './__fixtures__/emails';

/** Repositorio en memoria con lo mínimo que usa la ingesta. */
function fakeRepo<T extends { id?: string }>() {
  const rows: T[] = [];
  const match = (r: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    rows,
    create: (x: Partial<T>) => ({ ...x }) as T,
    save: async (x: any) => {
      const list = Array.isArray(x) ? x : [x];
      for (const it of list) {
        if (!it.id) it.id = randomUUID();
        if (!rows.includes(it)) rows.push(it);
      }
      return x;
    },
    findOne: async ({ where }: any) => rows.find((r) => match(r, where)) ?? null,
    find: async ({ where }: any = {}) => rows.filter((r) => match(r, where)),
    delete: async (where: any) => {
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) rows.splice(i, 1);
    },
  };
}

function mail(from: string, messageId: string): Buffer {
  return Buffer.from(
    [
      `From: Agente <${from}>`,
      'To: sistemas@paqueteriaymensajeriadelyaqui.com',
      `Subject: ${CABORCA.subject}`,
      `Message-ID: <${messageId}>`,
      'Date: Thu, 01 Oct 2026 17:12:00 -0700',
      'Content-Type: text/plain; charset=utf-8',
      '',
      CABORCA.body,
    ].join('\r\n'),
  );
}

describe('InboxIngestService.ingestRaw', () => {
  const STORAGE = 'tmp-test-inbox';
  let svc: InboxIngestService;
  let msgs: ReturnType<typeof fakeRepo>;
  let cons: ReturnType<typeof fakeRepo>;

  beforeEach(() => {
    msgs = fakeRepo();
    cons = fakeRepo();
    const config = { get: (k: string) => ({ INBOX_STORAGE_DIR: STORAGE, INBOX_ALLOWED_DOMAINS: 'fedex.com' } as any)[k] };
    const knowledge = { load: async () => ({ subsidiaries: [{ id: 'caborca', name: 'Caborca', region: 'SON' }], zipCoverage: [], aliases: [], knownConsolidations: [] }) };
    svc = new InboxIngestService(config as any, {} as any, knowledge as any, msgs as any, fakeRepo() as any, fakeRepo() as any, cons as any, fakeRepo() as any);
  });

  afterAll(async () => {
    await fs.rm(join(process.cwd(), STORAGE), { recursive: true, force: true });
  });

  it('correo que no viene de FedEx ni de DHL queda ignorado, sin cuerpo guardado', async () => {
    const r = await svc.ingestRaw({ uid: 1, uidValidity: '7', source: mail('pmyapp@paqueteriaymensajeriadelyaqui.com', 'a@x'), internalDate: null }, 'INBOX');
    expect(r).toBe('ignored');
    expect(msgs.rows[0]).toMatchObject({ status: 'ignorado', ignoreReason: 'No viene de FedEx ni de DHL' });
    expect((msgs.rows[0] as any).textTop).toBeUndefined();
  });

  it('correo de DHL (dominio dhl.com) ya no se ignora: entra a la bandeja', async () => {
    const r = await svc.ingestRaw({ uid: 9, uidValidity: '7', source: mail('ops@dhl.com', 'c@dhl.com'), internalDate: null }, 'INBOX');
    expect(r).toBe('saved');
    expect((msgs.rows[0] as any).status).not.toBe('ignorado');
  });

  it('reenvío desde hotmail de un correo de DHL entra como DHL (y se puede reconsiderar si estaba ignorado)', async () => {
    const fwd = (id: string) => Buffer.from([
      'From: PMY <paqueteriaymensajeriadelyaqui@hotmail.com>',
      'To: sistemas@paqueteriaymensajeriadelyaqui.com',
      'Subject: RV: FD VICAM',
      `Message-ID: <${id}>`,
      'Date: Thu, 28 May 2026 10:00:00 -0700',
      'Content-Type: text/plain; charset=utf-8',
      '',
      '________________________________',
      'De: ELMA LILIA VAZQUEZ ZAMARRON (DHL MX) <elma.vazquez@dhl.com>',
      'Enviado: martes, 26 de mayo de 2026 16:19',
      'Asunto: FD VICAM',
    ].join('\r\n'));
    // Antes del cambio quedó ignorado por remitente:
    msgs.rows.push({ id: 'old', mailbox: 'INBOX', uidValidity: '7', uid: 30, status: 'ignorado', ignoreReason: 'No viene de FedEx' } as any);
    expect(await svc.ingestRaw({ uid: 30, uidValidity: '7', source: fwd('f1@x'), internalDate: null }, 'INBOX')).toBe('duplicates');
    expect(await svc.ingestRaw({ uid: 30, uidValidity: '7', source: fwd('f1@x'), internalDate: null }, 'INBOX', true)).toBe('saved');
    expect(msgs.rows[0]).toMatchObject({ id: 'old', carrier: 'dhl', ignoreReason: null });
    expect((msgs.rows[0] as any).status).not.toBe('ignorado');
  });

  it('correo FedEx: se detecta, se registra el consolidado y no se duplica al releer', async () => {
    const raw = { uid: 2, uidValidity: '7', source: mail('miguel.antonio@fedex.com', 'b@fedex.com'), internalDate: null };
    expect(await svc.ingestRaw(raw, 'INBOX')).toBe('saved');
    expect(msgs.rows[0]).toMatchObject({ status: 'revision', subsidiaryId: 'caborca' });
    expect(cons.rows.map((c: any) => `${c.kind}:${c.consNumber}:${c.announcedCount}`)).toEqual(['master:818861721255:123']);
    expect((cons.rows[0] as any).cobros).toHaveLength(3);

    expect(await svc.ingestRaw(raw, 'INBOX')).toBe('duplicates');
    expect(await svc.ingestRaw({ ...raw, uid: 3 }, 'INBOX')).toBe('duplicates'); // mismo Message-ID con otro UID
    expect(msgs.rows).toHaveLength(1);
  });
});
