/**
 * Limpieza de cobros — parte C del análisis "DIF CABOS SEM 28SEP-03OCT" (2026-10-06).
 *
 * POR DEFECTO NO ESCRIBE NADA: muestra qué cambiaría y deja un Excel con el detalle.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/limpieza-cobros-2026-10.ts
 *   npx ts-node -r tsconfig-paths/register scripts/limpieza-cobros-2026-10.ts --apply C1,C2,C3,C4,C5 --user <userId>
 *
 * Opciones: --desde 2026-09-01 (C2/C3) · --desde-dev 2026-08-01 (C4/C5) · --out <archivo.xlsx>
 *           --ensayo (con --apply: aplica, verifica y revierte; no deja cambios)
 *
 * Correcciones (cada una en su propia transacción; nunca borra, ANULA con motivo y bitácora):
 *  C1  Consolidado dado de baja con ingresos vivos (305821198046) → anula sus ingresos.
 *  C2  Guía cobrada como paquete Y como carga F2 del mismo consolidado → anula el ingreso por
 *      paquete y da de baja la fila duplicada (la guía sigue en la carga).
 *  C3  Ingreso en otra sucursal porque el consolidado se movió por fuera de la app (sin traspaso
 *      y el consolidado es de la sucursal de la guía) → pasa a la sucursal de la guía con su tarifa.
 *  C4  Entrega fantasma cobrada (después del "entregado" FedEx siguió moviendo el paquete) → anula.
 *  C5  Devuelta que "revivió" a entregado SIN ruta nuestra ese día → anula y regresa a devuelto.
 * Bitácora: income_change_log (historial del Consolidador), consolidated_change_log y audit_log.
 *
 * Solo REPORTE (hoja "Revisar"): C2/C3 anteriores a --desde, C5 con ruta nuestra ese día,
 * consolidados activos en 2 sucursales, ingresos con evento > 7 días antes del consolidado.
 */
import 'dotenv/config';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { AppDataSource as ds } from '../src/data-source';

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? 'true' : def;
};
const DESDE = arg('desde', '2026-09-01')!;
const DESDE_DEV = arg('desde-dev', '2026-08-01')!;
const APPLY = new Set((arg('apply', '') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
const USER_ID = arg('user') ?? null;
const OUT = arg('out', `limpieza-cobros-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.xlsx`)!;
const ACTION = 'limpieza_2026_10';
/** --ensayo: aplica dentro de la transacción, verifica y REVIERTE (no deja cambios). */
const ENSAYO = process.argv.includes('--ensayo');
class Rollback extends Error {}

type Row = Record<string, any>;
const money = (rows: Row[], k = 'cost') => Math.round(rows.reduce((s, r) => s + Number(r[k] || 0), 0) * 100) / 100;
const COLL = 'utf8mb4_unicode_ci';
const NORM = (col: string) => `TRIM(UPPER(${col})) COLLATE ${COLL}`;

// ---------------------------------------------------------------- detección
async function detectC1(): Promise<Row[]> {
  return ds.query(`
    SELECT i.id incomeId, i.trackingNumber, i.cost, i.incomeType, i.date, sb.name sucursal, c.consNumber, 'shipment' via
      FROM consolidated c
      JOIN subsidiary sb ON sb.id = c.subsidiaryId
      JOIN shipment s ON s.consolidatedId = c.id
      JOIN income i ON i.shipmentId = s.id AND i.active = 1
     WHERE c.active = 0
       AND NOT EXISTS (SELECT 1 FROM consolidated c2 WHERE c2.subsidiaryId = c.subsidiaryId
                        AND ${NORM('c2.consNumber')} = ${NORM('c.consNumber')} AND c2.active = 1)`);
}

async function c2Base(where: string): Promise<Row[]> {
  return ds.query(`
    SELECT s.id shipmentId, s.trackingNumber, sb.name sucursal, c.consNumber, DATE(c.date) consDate,
           i.id incomeId, i.cost, i.incomeType, i.date
      FROM shipment s
      JOIN consolidated c ON c.id = s.consolidatedId
      JOIN subsidiary sb ON sb.id = s.subsidiaryId
      LEFT JOIN income i ON i.shipmentId = s.id AND i.active = 1
     WHERE s.active = 1 AND ${where}
       AND EXISTS (SELECT 1 FROM charge_shipment cs
                    WHERE cs.trackingNumber = s.trackingNumber AND cs.active = 1 AND cs.subsidiaryId = s.subsidiaryId
                      AND ${NORM('cs.consNumber')} = ${NORM('c.consNumber')})`);
}
const detectC2 = () => c2Base(`c.date >= '${DESDE}'`);
const reportC2Old = () => c2Base(`c.date < '${DESDE}'`);

async function c3Base(where: string): Promise<Row[]> {
  return ds.query(`
    SELECT i.id incomeId, i.trackingNumber, i.cost, i.originalCost, i.incomeType, i.date, i.shipmentType,
           si.name sucursalIngreso, ss.name sucursalGuia, s.subsidiaryId newSubsidiaryId,
           CASE WHEN LOWER(COALESCE(i.shipmentType, s.shipmentType)) = 'dhl' THEN ss.dhlCostPackage ELSE ss.fedexCostPackage END newCost,
           c.consNumber
      FROM income i
      JOIN shipment s ON s.id = i.shipmentId
      JOIN consolidated c ON c.id = s.consolidatedId
      JOIN subsidiary si ON si.id = i.subsidiaryId
      JOIN subsidiary ss ON ss.id = s.subsidiaryId
     WHERE i.active = 1 AND i.sourceType = 'shipment' AND ${where}
       AND i.subsidiaryId <> s.subsidiaryId
       AND c.subsidiaryId = s.subsidiaryId
       AND NOT EXISTS (SELECT 1 FROM package_transfer pt WHERE pt.shipmentId = s.id)`);
}
const detectC3 = () => c3Base(`i.date >= '${DESDE}'`);
const reportC3Old = () => c3Base(`i.date < '${DESDE}'`);

async function detectC4(): Promise<Row[]> {
  return ds.query(`
    SELECT i.id incomeId, i.trackingNumber, i.cost, i.date, sb.name sucursal, s.status estatusGuia,
           (SELECT MIN(ss.timestamp) FROM shipment_status ss WHERE ss.shipmentId = s.id AND ss.timestamp > i.date
              AND ss.notes REGEXP '^(PU|DP|AR|AF|IT|OD) - ') movimientoDespues
      FROM income i
      JOIN shipment s ON s.id = i.shipmentId
      JOIN subsidiary sb ON sb.id = i.subsidiaryId
     WHERE i.active = 1 AND i.sourceType = 'shipment' AND i.incomeType = 'entregado' AND i.date >= '${DESDE_DEV}'
       AND EXISTS (SELECT 1 FROM shipment_status ss WHERE ss.shipmentId = s.id AND ss.timestamp > i.date
                    AND ss.notes REGEXP '^(PU|DP|AR|AF|IT|OD) - ')`);
}

async function c5Base(withRoute: boolean): Promise<Row[]> {
  return ds.query(`
    SELECT s.id shipmentId, s.trackingNumber, sb.name sucursal, d.date devolucion, i.id incomeId, i.cost, i.date
      FROM devolution d
      JOIN shipment s ON s.trackingNumber = d.trackingNumber AND (d.consolidatedId IS NULL OR s.consolidatedId = d.consolidatedId)
      JOIN subsidiary sb ON sb.id = s.subsidiaryId
      JOIN income i ON i.shipmentId = s.id AND i.active = 1 AND i.incomeType = 'entregado' AND i.date > d.date
     WHERE s.status = 'entregado' AND d.date >= '${DESDE_DEV}'
       AND ${withRoute ? '' : 'NOT '}EXISTS (
            SELECT 1 FROM package_dispatch_history h JOIN package_dispatch pd ON pd.id = h.dispatchId
             WHERE h.shipmentId = s.id
               AND DATE(COALESCE(pd.routeDate, DATE_SUB(pd.createdAt, INTERVAL 7 HOUR))) = DATE(DATE_SUB(i.date, INTERVAL 7 HOUR)))`);
}

async function reportMultiSubsidiary(): Promise<Row[]> {
  return ds.query(`
    SELECT TRIM(UPPER(c.consNumber)) consNumber, GROUP_CONCAT(DISTINCT sb.name ORDER BY sb.name SEPARATOR ' + ') sucursales,
           MIN(DATE(c.date)) fecha, COUNT(*) filas
      FROM consolidated c JOIN subsidiary sb ON sb.id = c.subsidiaryId
     WHERE c.active = 1 AND TRIM(c.consNumber) <> '' AND c.date >= '2026-06-01'
     GROUP BY TRIM(UPPER(c.consNumber)) HAVING COUNT(DISTINCT c.subsidiaryId) > 1`);
}

async function reportOldEvents(): Promise<Row[]> {
  return ds.query(`
    SELECT i.id incomeId, i.trackingNumber, sb.name sucursal, c.consNumber, DATE(c.date) consDate, i.date ingreso, i.cost,
           DATEDIFF(DATE(c.date), DATE(DATE_SUB(i.date, INTERVAL 7 HOUR))) diasAntes
      FROM income i JOIN shipment s ON s.id = i.shipmentId JOIN consolidated c ON c.id = s.consolidatedId
      JOIN subsidiary sb ON sb.id = i.subsidiaryId
     WHERE i.active = 1 AND i.sourceType = 'shipment' AND c.date >= '2026-08-01'
       AND DATEDIFF(DATE(c.date), DATE(DATE_SUB(i.date, INTERVAL 7 HOUR))) > 7`);
}

// ---------------------------------------------------------------- escritura
async function logChanges(m: EntityManager, code: string, rows: { entityType: string; entityId: string; tn: string | null; cons?: string | null; field: string; old: any; nw: any }[], reason: string) {
  for (const r of rows) {
    await m.query(
      `INSERT INTO consolidated_change_log (id, approvalRequestId, action, consNumber, entityType, entityId, trackingNumber, field, oldValue, newValue, userId, userName, createdAt)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Limpieza 2026-10', NOW())`,
      [randomUUID(), `${ACTION}_${code}`, r.cons ?? null, r.entityType, r.entityId, r.tn, r.field, r.old == null ? null : String(r.old), r.nw == null ? null : String(r.nw), USER_ID],
    );
    if (r.entityType === 'income') {
      const action = r.field === 'active' ? 'delete' : r.field === 'subsidiaryId' ? 'reassign' : 'cost_edit';
      await m.query(
        `INSERT INTO income_change_log (id, incomeId, shipmentId, action, field, oldValue, newValue, reason, userId, createdAt)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NOW())`,
        [randomUUID(), r.entityId, action, r.field, r.old == null ? null : String(r.old), r.nw == null ? null : String(r.nw), reason.slice(0, 255), USER_ID],
      );
    }
  }
}

async function annulIncomes(m: EntityManager, code: string, rows: Row[], reason: string) {
  const ids = [...new Set(rows.map((r) => r.incomeId).filter(Boolean))];
  for (const id of ids) {
    await m.query(
      `UPDATE income SET active = 0, annulledAt = NOW(), annulledById = ?, updatedById = ?, updatedAt = NOW(), editReason = ?
        WHERE id = ? AND active = 1`,
      [USER_ID, USER_ID, reason.slice(0, 255), id],
    );
  }
  const byId = new Map(rows.map((r) => [r.incomeId, r]));
  await logChanges(m, code, ids.map((id) => ({ entityType: 'income', entityId: id, tn: byId.get(id)?.trackingNumber ?? null, cons: byId.get(id)?.consNumber, field: 'active', old: 1, nw: 0 })), reason);
}

async function audit(m: EntityManager, code: string, description: string, meta: any) {
  await m.query(
    `INSERT INTO audit_log (id, userId, userName, module, action, result, severity, entityName, description, metadata, createdAt)
     VALUES (?, ?, 'Limpieza 2026-10', 'consolidados', 'update', 'success', 'warning', 'Ingresos', ?, ?, NOW())`,
    [randomUUID(), USER_ID, description.slice(0, 500), JSON.stringify({ code, ...meta })],
  );
}

const APPLIERS: Record<string, (m: EntityManager, rows: Row[]) => Promise<void>> = {
  C1: async (m, rows) => {
    const reason = 'Limpieza 2026-10 (C1): consolidado dado de baja (duplicado de otra sucursal); su ingreso no corresponde.';
    await annulIncomes(m, 'C1', rows, reason);
  },
  C2: async (m, rows) => {
    const reason = 'Limpieza 2026-10 (C2): la guía ya se cobra en la carga F2 del mismo consolidado; cobro por paquete duplicado.';
    await annulIncomes(m, 'C2', rows, reason);
    const ships = [...new Map(rows.map((r) => [r.shipmentId, r])).values()];
    for (const s of ships) await m.query('UPDATE shipment SET active = 0 WHERE id = ? AND active = 1', [s.shipmentId]);
    await logChanges(m, 'C2', ships.map((s) => ({ entityType: 'shipment', entityId: s.shipmentId, tn: s.trackingNumber, cons: s.consNumber, field: 'active', old: 1, nw: 0 })), reason);
  },
  C3: async (m, rows) => {
    const reason = 'Limpieza 2026-10 (C3): el consolidado se movió de sucursal; el ingreso pasa a la sucursal de la guía con su tarifa.';
    const changes: any[] = [];
    for (const r of rows) {
      const newCost = Number(r.newCost || 0);
      await m.query(
        `UPDATE income SET subsidiaryId = ?, cost = ?, originalCost = COALESCE(originalCost, ?), updatedById = ?, updatedAt = NOW(), editReason = ?
          WHERE id = ? AND active = 1`,
        [r.newSubsidiaryId, newCost, Number(r.cost), USER_ID, reason.slice(0, 255), r.incomeId],
      );
      changes.push({ entityType: 'income', entityId: r.incomeId, tn: r.trackingNumber, cons: r.consNumber, field: 'subsidiaryId', old: r.sucursalIngreso, nw: r.sucursalGuia });
      if (Number(r.cost) !== newCost) changes.push({ entityType: 'income', entityId: r.incomeId, tn: r.trackingNumber, cons: r.consNumber, field: 'cost', old: r.cost, nw: newCost });
    }
    await logChanges(m, 'C3', changes, reason);
  },
  C4: async (m, rows) => {
    const reason = 'Limpieza 2026-10 (C4): entrega fantasma (FedEx siguió moviendo el paquete después del "entregado"); no se cobra.';
    await annulIncomes(m, 'C4', rows, reason);
  },
  C5: async (m, rows) => {
    const reason = 'Limpieza 2026-10 (C5): guía devuelta a FedEx que FedEx entregó sin ruta nuestra; vuelve a devuelto y no se cobra.';
    await annulIncomes(m, 'C5', rows, reason);
    const ships = [...new Map(rows.map((r) => [r.shipmentId, r])).values()];
    for (const s of ships) {
      await m.query(`UPDATE shipment SET status = 'devuelto_a_fedex' WHERE id = ? AND status = 'entregado'`, [s.shipmentId]);
      await m.query(
        `INSERT INTO shipment_status (id, status, exceptionCode, timestamp, notes, createdAt, shipmentId)
         VALUES (?, 'devuelto_a_fedex', NULL, NOW(), 'Limpieza 2026-10: vuelve a devuelto (FedEx la entregó sin ruta nuestra)', NOW(), ?)`,
        [randomUUID(), s.shipmentId],
      );
    }
    await logChanges(m, 'C5', ships.map((s) => ({ entityType: 'shipment', entityId: s.shipmentId, tn: s.trackingNumber, field: 'status', old: 'entregado', nw: 'devuelto_a_fedex' })), reason);
  },
};

// ---------------------------------------------------------------- main
async function main() {
  if (APPLY.size && !USER_ID && !ENSAYO) throw new Error('Para aplicar indica --user <id del usuario que autoriza>.');
  await ds.initialize();
  const [{ db }] = await ds.query('SELECT DATABASE() db');
  const host = (ds.options as any).host;
  console.log(`\nBase de datos: ${db} @ ${host}   ·   modo: ${APPLY.size ? `APLICAR ${[...APPLY].join(',')}` : 'SOLO MOSTRAR'}\n`);

  const sets: Record<string, Row[]> = {
    C1: await detectC1(),
    C2: await detectC2(),
    C3: await detectC3(),
    C4: await detectC4(),
    C5: await c5Base(false),
  };
  const summary: Row[] = [];
  const line = (code: string, desc: string, rows: Row[], amount: number) => {
    summary.push({ correccion: code, descripcion: desc, registros: rows.length, monto: amount });
    console.log(`${code}  ${desc.padEnd(62)} ${String(rows.length).padStart(5)} reg.  ${amount >= 0 ? ' ' : ''}${amount.toFixed(2)}`);
  };
  const inc = (rows: Row[]) => [...new Map(rows.filter((r) => r.incomeId).map((r) => [r.incomeId, r])).values()];
  line('C1', 'Anular ingresos de consolidado dado de baja', inc(sets.C1), -money(inc(sets.C1)));
  line('C2', `Anular cobro por paquete de guías F2 (desde ${DESDE})`, inc(sets.C2), -money(inc(sets.C2)));
  line('C2', '  · filas de guía duplicadas a dar de baja', [...new Set(sets.C2.map((r) => r.shipmentId))], 0);
  const c3Delta = Math.round(sets.C3.reduce((s, r) => s + Number(r.newCost || 0) - Number(r.cost || 0), 0) * 100) / 100;
  line('C3', `Mover ingreso a la sucursal de la guía (desde ${DESDE}) · diferencia`, sets.C3, c3Delta);
  line('C4', `Anular entregas fantasma cobradas (desde ${DESDE_DEV})`, inc(sets.C4), -money(inc(sets.C4)));
  line('C5', `Devueltas revividas sin ruta nuestra (desde ${DESDE_DEV})`, inc(sets.C5), -money(inc(sets.C5)));

  const revisar: Record<string, Row[]> = {
    'Revisar C2 antes': await reportC2Old(),
    'Revisar C3 antes': await reportC3Old(),
    'Revisar C5 con ruta': await c5Base(true),
    'Revisar cons 2 sucursales': await reportMultiSubsidiary(),
    'Revisar evento >7d': await reportOldEvents(),
  };
  console.log('\nSolo reporte (no se cambia):');
  for (const [k, rows] of Object.entries(revisar)) console.log(`  ${k.padEnd(28)} ${rows.length} reg.`);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Resumen');
  for (const [k, rows] of Object.entries(sets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ sinRegistros: true }]), k);
  for (const [k, rows] of Object.entries(revisar)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ sinRegistros: true }]), k.slice(0, 31));
  XLSX.writeFile(wb, OUT);
  console.log(`\nDetalle en: ${OUT}`);

  for (const code of ['C1', 'C2', 'C3', 'C4', 'C5']) {
    if (!APPLY.has(code)) continue;
    const rows = sets[code];
    if (!rows.length) { console.log(`${code}: nada que aplicar.`); continue; }
    try {
      await ds.transaction(async (m) => {
        await APPLIERS[code](m, rows);
        await audit(m, code, `Limpieza 2026-10 ${code}: ${rows.length} registros`, { desde: DESDE, desdeDev: DESDE_DEV, registros: rows.length });
        if (ENSAYO) {
          const ids = [...new Set(rows.map((r) => r.incomeId).filter(Boolean))];
          const [v] = ids.length
            ? await m.query('SELECT SUM(active = 0) anulados, SUM(active = 1) activos, SUM(cost) monto FROM income WHERE id IN (?)', [ids])
            : [{}];
          const [l] = await m.query('SELECT COUNT(*) n FROM consolidated_change_log WHERE action = ?', [`${ACTION}_${code}`]);
          console.log(`${code} (ensayo): ingresos anulados=${v.anulados ?? 0} activos=${v.activos ?? 0} monto=${v.monto ?? 0} · bitácora=${l.n}`);
          throw new Rollback();
        }
      });
      console.log(`${code}: aplicado (${rows.length} registros).`);
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
      console.log(`${code}: ensayo revertido, sin cambios.`);
    }
  }
  await ds.destroy();
}

main().catch(async (e) => {
  console.error('ERROR:', e?.message ?? e);
  try { await ds.destroy(); } catch { /* */ }
  process.exit(1);
});
