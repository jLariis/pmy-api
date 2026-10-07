/**
 * Reparación de cargas F2 que nacieron CLONADAS de un registro final (2026-10-07).
 *
 * La migración paquete→carga de `processFileF2` (ya eliminada: toda subida crea registro nuevo)
 * clonaba el paquete existente aunque estuviera DEVUELTO o ENTREGADO: la carga nueva nacía con
 * su estatus final, su consolidado/consNumber viejo y su historial copiado (cada fila dos veces),
 * y la salida a ruta la rechazaba ("La guía ya fue devuelta a FedEx").
 *
 * Detecta cargas activas (últimos --dias) con filas de historial HEREDADAS (creadas a más tardar
 * 5 s después de la carga y con fecha anterior a ella) que incluyen un estatus final. A cada una:
 *   - le quita el historial heredado (nunca toca eventos posteriores a su alta),
 *   - la deja PENDIENTE con su registro inicial (el cron le pone después el estatus real de FedEx),
 *   - la liga al consolidado y consNumber de SU F2 (tabla charge).
 * NO se tocan: cargas que ya salieron a ruta (se listan para revisión) ni el paquete viejo.
 *
 * POR DEFECTO NO ESCRIBE NADA: muestra qué cambiaría y deja un Excel con el detalle.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-cargas-clonadas-2026-10.ts
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-cargas-clonadas-2026-10.ts --apply --user <userId>
 *
 * Opciones: --dias 30 · --ensayo (con --apply: aplica, verifica y REVIERTE) · --out <archivo.xlsx>
 * Bitácora: consolidated_change_log (action reparar_cargas_clonadas) y audit_log.
 */
import 'dotenv/config';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { AppDataSource as ds } from '../src/data-source';

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? 'true' : def;
};
const DIAS = Math.max(1, Number(arg('dias', '30')) || 30);
const APPLY = process.argv.includes('--apply');
const ENSAYO = process.argv.includes('--ensayo');
const USER_ID = arg('user') ?? null;
const OUT = arg('out', `reparar-cargas-clonadas-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.xlsx`)!;
const ACTION = 'reparar_cargas_clonadas';
const WHO = 'Reparación cargas clonadas 2026-10';
const FINALES = `('devuelto_a_fedex','entregado','retorno_abandono_fedex')`;
// Fila heredada: creada junto con la carga (≤5 s) y con fecha anterior a ella. El registro
// inicial propio de una F2 nueva ("Cargado ... F2") nunca cuenta como heredado.
const HEREDADA = `ss.chargeShipmentId = cs.id AND ss.createdAt <= cs.createdAt + INTERVAL 5 SECOND
  AND ss.timestamp < cs.createdAt AND (ss.notes IS NULL OR ss.notes NOT LIKE 'Cargado%F2%')`;
class Rollback extends Error {}

type Row = Record<string, any>;

async function detect(): Promise<{ reparar: Row[]; revisar: Row[] }> {
  const rows: Row[] = await ds.query(
    `SELECT cs.id, cs.trackingNumber AS guia, s.name AS sucursal, cs.status AS estatus,
            DATE_FORMAT(cs.createdAt, '%Y-%m-%d %H:%i:%s') AS creada, cs.createdAt AS creadaRaw,
            cs.consNumber AS consNumberActual, cs.consolidatedId AS consolidadoActual,
            ch.consNumber AS consNumberF2,
            (SELECT c.id FROM consolidated c WHERE TRIM(UPPER(c.consNumber)) = TRIM(UPPER(ch.consNumber))
               AND c.subsidiaryId = cs.subsidiaryId ORDER BY c.createdAt DESC LIMIT 1) AS consolidadoF2,
            (SELECT COUNT(*) FROM shipment_status ss WHERE ${HEREDADA}) AS filasHeredadas,
            (SELECT COUNT(*) FROM package_dispatch_history h WHERE h.chargeShipmentId = cs.id) AS enRutas
       FROM charge_shipment cs
       JOIN subsidiary s ON s.id = cs.subsidiaryId
       LEFT JOIN charge ch ON ch.id = cs.chargeId
      WHERE cs.active = 1 AND cs.createdAt >= NOW() - INTERVAL ? DAY
        AND EXISTS (SELECT 1 FROM shipment_status ss WHERE ${HEREDADA} AND ss.status IN ${FINALES})
      ORDER BY s.name, cs.createdAt`,
    [DIAS],
  );
  const reparar: Row[] = [];
  const revisar: Row[] = [];
  for (const r of rows) {
    r.filasHeredadas = Number(r.filasHeredadas);
    r.enRutas = Number(r.enRutas);
    if (r.enRutas > 0) revisar.push({ ...r, motivo: 'Ya salió a ruta: no se toca, revisar a mano' });
    else if (!r.consolidadoF2) revisar.push({ ...r, motivo: 'No se encontró el consolidado de su F2' });
    else reparar.push(r);
  }
  return { reparar, revisar };
}

const view = (r: Row) => {
  const { id, creadaRaw, ...rest } = r;
  return rest;
};

async function main() {
  if (APPLY && !USER_ID && !ENSAYO) throw new Error('Para aplicar indica --user <id del usuario que autoriza>.');
  await ds.initialize();
  const [{ db }] = await ds.query('SELECT DATABASE() db');
  console.log(`\nBase de datos: ${db} @ ${(ds.options as any).host}   ·   modo: ${APPLY ? (ENSAYO ? 'ENSAYO (revierte)' : 'APLICAR') : 'SOLO MOSTRAR'}   ·   últimos ${DIAS} días\n`);

  const { reparar, revisar } = await detect();
  console.log(`A reparar: ${reparar.length}`);
  for (const r of reparar) {
    console.log(`  ${r.sucursal.padEnd(14)} ${r.guia}  ${r.estatus} → pendiente   cons ${r.consNumberActual} → ${r.consNumberF2}   quita ${r.filasHeredadas} filas heredadas`);
  }
  console.log(`\nNo se tocan: ${revisar.length}`);
  for (const r of revisar) console.log(`  ${r.sucursal.padEnd(14)} ${r.guia}  ${r.estatus}   ${r.motivo}`);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reparar.length ? reparar.map(view) : [{ sinRegistros: true }]), 'A reparar');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(revisar.length ? revisar.map(view) : [{ sinRegistros: true }]), 'No se tocan');
  XLSX.writeFile(wb, OUT);
  console.log(`\nDetalle en: ${OUT}`);

  if (APPLY && reparar.length) {
    try {
      await ds.transaction(async (m) => {
        for (const r of reparar) {
          const del = await m.query(
            `DELETE ss FROM shipment_status ss JOIN charge_shipment cs ON cs.id = ss.chargeShipmentId WHERE cs.id = ? AND ${HEREDADA}`,
            [r.id],
          );
          await m.query(
            `UPDATE charge_shipment SET status = 'pendiente', consolidatedId = ?, consNumber = ? WHERE id = ?`,
            [r.consolidadoF2, r.consNumberF2, r.id],
          );
          await m.query(
            `INSERT INTO shipment_status (id, status, exceptionCode, timestamp, notes, chargeShipmentId, createdAt)
             VALUES (?, 'pendiente', '', ?, ?, ?, NOW())`,
            [randomUUID(), r.creadaRaw, 'Cargado desde archivo F2 (reparación: se quitó el historial heredado de un registro anterior)', r.id],
          );
          const cambios: [string, string | null, string | null][] = [
            ['status', r.estatus, 'pendiente'],
            ['consNumber', r.consNumberActual, r.consNumberF2],
            ['consolidatedId', r.consolidadoActual, r.consolidadoF2],
            ['historial', `${r.filasHeredadas} filas heredadas`, `${del?.affectedRows ?? del?.[1] ?? '?'} borradas`],
          ];
          for (const [field, oldValue, newValue] of cambios) {
            await m.query(
              `INSERT INTO consolidated_change_log (id, approvalRequestId, action, consNumber, entityType, entityId, trackingNumber, field, oldValue, newValue, userId, userName, createdAt)
               VALUES (?, NULL, ?, ?, 'charge_shipment', ?, ?, ?, ?, ?, ?, ?, NOW())`,
              [randomUUID(), ACTION, r.consNumberF2, r.id, r.guia, field, oldValue, newValue, USER_ID, WHO],
            );
          }
        }
        await m.query(
          `INSERT INTO audit_log (id, userId, userName, module, action, result, severity, entityName, description, metadata, createdAt)
           VALUES (?, ?, ?, 'consolidados', 'update', 'success', 'warning', 'Cargas F2', ?, ?, NOW())`,
          [randomUUID(), USER_ID, WHO, `Cargas F2 clonadas de un registro final reparadas: ${reparar.length}`.slice(0, 500),
            JSON.stringify({ guias: reparar.map((r) => r.guia) })],
        );
        if (ENSAYO) {
          const ok = (await Promise.all(reparar.map(async (r) => {
            const [row] = await m.query(
              `SELECT cs.status, cs.consolidatedId,
                      (SELECT COUNT(*) FROM shipment_status ss WHERE ${HEREDADA}) AS heredadas
                 FROM charge_shipment cs WHERE cs.id = ?`, [r.id]);
            return row?.status === 'pendiente' && row?.consolidatedId === r.consolidadoF2 && Number(row?.heredadas) === 0;
          }))).filter(Boolean).length;
          console.log(`\nEnsayo: ${ok}/${reparar.length} cargas quedaron pendientes, en su consolidado F2 y sin historial heredado.`);
          throw new Rollback();
        }
      });
      console.log(`\nAplicado: ${reparar.length} cargas reparadas.`);
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
      console.log('Ensayo revertido, sin cambios.');
    }
  } else if (APPLY) {
    console.log('\nNada que aplicar.');
  }
  await ds.destroy();
}

main().catch(async (e) => {
  console.error('ERROR:', e?.message ?? e);
  try { await ds.destroy(); } catch { /* */ }
  process.exit(1);
});
