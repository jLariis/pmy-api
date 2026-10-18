import 'dotenv/config';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { config } from '../config/config';
import { DailyTaskFactsService } from './daily-task-facts.service';

/**
 * Integración contra la BD LOCAL (solo con DAILY_TASKS_DB_TEST=1). Todo corre dentro de una
 * transacción que se revierte: no deja datos. Día lejano (2031-03-03) para no chocar con datos reales.
 */
const run = process.env.DAILY_TASKS_DB_TEST === '1' ? describe : describe.skip;

run('DailyTaskFactsService (BD local)', () => {
  const D = '2031-03-03';
  const Z = (iso: string) => iso.replace('T', ' ').replace('Z', '');
  let ds: DataSource;
  let qr: QueryRunner;
  let svc: DailyTaskFactsService;
  let sub: string;
  let user: string;
  const C = randomUUID();
  const S = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

  beforeAll(async () => {
    ds = new DataSource({ ...(config().database as any), migrations: [], logging: false });
    await ds.initialize();
    qr = ds.createQueryRunner();
    await qr.startTransaction();
    const q = (sql: string, p: any[] = []) => qr.query(sql, p);
    sub = (await q('SELECT id FROM subsidiary WHERE active = 1 LIMIT 1'))[0].id;
    user = (await q('SELECT id FROM `user` LIMIT 1'))[0].id;

    await q('INSERT INTO consolidated (id, date, numberOfPackages, isCompleted, consNumber, subsidiaryId, createdById, carrier, type, active, createdAt) VALUES (?, ?, 4, 0, ?, ?, ?, ?, ?, 1, ?)', [
      C, Z('2031-03-03T07:00:00Z'), 'TEST-DT-1', sub, user, 'fedex', 'ordinario', Z('2031-03-03T13:40:00Z'),
    ]);
    const U = randomUUID();
    await q("INSERT INTO unloading (id, trackingNumber, missingTrackings, unScannedTrackings, subsidiaryId, createdById, createdAt) VALUES (?, ?, '[]', '[]', ?, ?, ?)", [U, 'U-' + U.slice(0, 8), sub, user, Z('2031-03-03T15:00:00Z')]);

    const ship = (id: string, tn: string, status: string, unloaded: boolean) =>
      q("INSERT INTO shipment (id, trackingNumber, recipientName, recipientAddress, recipientCity, recipientZip, recipientPhone, commitDateTime, status, consolidatedId, subsidiaryId, unloadingId, active) VALUES (?, ?, 'x', 'x', 'x', '0', '0', ?, ?, ?, ?, ?, 1)", [
        id, tn, Z('2031-03-03T23:00:00Z'), status, C, sub, unloaded ? U : null,
      ]);
    await ship(S[0], 'DT-0001', 'entregado', true);
    await ship(S[1], 'DT-0002', 'cliente_no_disponible', true);
    await ship(S[2], 'DT-0003', 'en_bodega', true);
    await ship(S[3], 'DT-0004', 'pendiente', false);

    const D1 = randomUUID();
    const D2 = randomUUID();
    for (const [id, at] of [[D1, '2031-03-03T16:00:00Z'], [D2, '2031-03-03T18:00:00Z']]) {
      await q("INSERT INTO package_dispatch (id, trackingNumber, status, subsidiaryId, createdById, createdAt, routeDate, active) VALUES (?, ?, 'Completada', ?, ?, ?, ?, 1)", [id, 'PD-' + id.slice(0, 8), sub, user, Z(at), D]);
      await q("INSERT INTO route_closure (id, closeDate, collections, package_dispatch_id, subsidiaryId, createdById, createdAt) VALUES (?, ?, '[]', ?, ?, ?, ?)", [randomUUID(), Z('2031-03-04T01:00:00Z'), id, sub, user, Z('2031-03-04T01:00:00Z')]);
    }
    const hist = (dispatchId: string, shipmentId: string, at: string) =>
      q('INSERT INTO package_dispatch_history (id, dispatchId, shipmentId, addedAt) VALUES (?, ?, ?, ?)', [randomUUID(), dispatchId, shipmentId, Z(at)]);
    await hist(D1, S[0], '2031-03-03T16:00:00Z');
    await hist(D1, S[1], '2031-03-03T16:00:00Z');
    await hist(D2, S[1], '2031-03-03T18:00:00Z'); // se movió a otra ruta

    await q("INSERT INTO shipment_status (id, status, exceptionCode, timestamp, shipmentId) VALUES (?, 'entregado', NULL, ?, ?)", [randomUUID(), Z('2031-03-03T19:00:00Z'), S[0]]);
    await q("INSERT INTO shipment_status (id, status, exceptionCode, timestamp, shipmentId) VALUES (?, 'cliente_no_disponible', '08', ?, ?)", [randomUUID(), Z('2031-03-03T20:00:00Z'), S[1]]);

    // Devolución registrada y luego DESHECHA: no cuenta.
    await q("INSERT INTO devolution (id, trackingNumber, reason, date, subsidiaryId, shipmentId, createdById, undoneAt, createdAt) VALUES (?, 'DT-0002', '08', ?, ?, ?, ?, ?, ?)", [
      randomUUID(), Z('2031-03-04T01:30:00Z'), sub, S[1], user, Z('2031-03-04T01:40:00Z'), Z('2031-03-04T01:30:00Z'),
    ]);
    await q("INSERT INTO inventory (id, trackingNumber, inventoryDate, subsidiaryId, type, createdById, createdAt) VALUES (?, ?, ?, ?, 'final', ?, ?)", [
      randomUUID(), 'INV-DT', Z('2031-03-04T02:30:00Z'), sub, user, Z('2031-03-04T02:30:00Z'),
    ]);

    svc = new DailyTaskFactsService(qr.manager as any);
  });

  afterAll(async () => {
    await qr?.rollbackTransaction();
    await qr?.release();
    await ds?.destroy();
  });

  it('consolidatedFacts: avance por paso del consolidado', async () => {
    const [f] = (await svc.consolidatedFacts(sub, D)).filter((x) => x.refId === C);
    expect(f).toMatchObject({ refType: 'consolidated', consNumber: 'TEST-DT-1', day: D, guides: 4 });
    expect(f.unloading).toMatchObject({ done: 3, total: 4 });
    expect(f.dispatch).toMatchObject({ done: 2, total: 3 });
    // La guía movida de ruta cuenta una vez y su cierre sale del historial.
    expect(f.closure).toMatchObject({ done: 2, total: 2 });
  });

  it('consolidatedFacts: devolución deshecha no cuenta como registrada', async () => {
    const [f] = (await svc.consolidatedFacts(sub, D)).filter((x) => x.refId === C);
    expect(f.devolutions).toMatchObject({ done: 0, total: 1 });
  });

  it('subsidiaryFacts: rutas, DEX e inventario final del día', async () => {
    const f = await svc.subsidiaryFacts(sub, D);
    expect(f).toMatchObject({ dispatchesTotal: 2, dispatchesClosed: 2, dexTotal: 1, dexWithDevolution: 0 });
    expect(f.inventoryFinalAt).not.toBeNull();
    expect(f.inventoryInitialAt).toBeNull();
  });

  it('packageDetail: resumen y posibles LD del día', async () => {
    const d = await svc.packageDetail('consolidated', C, D);
    expect(d.summary).toMatchObject({ delivered: 1, dex: { '08': 1 }, inWarehouse: 2, possibleLd: 2, missingUnloading: 1 });
    expect(d.guides.filter((g) => g.ld === 'possible_ld').map((g) => g.trackingNumber).sort()).toEqual(['DT-0003', 'DT-0004']);
  });
});
