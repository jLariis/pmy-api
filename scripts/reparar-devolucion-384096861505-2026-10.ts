/**
 * Reparación de la devolución de la guía 384096861505 (Bodega Hermosillo, 16-oct-2026).
 *
 * La guía tiene dos registros: el del consolidado del 15 (salió en la ruta del 15 y tuvo DEX17) y
 * el del 16 (subido 12:52, salió a ruta 12:55). A las 12:59 se capturó la devolución, que era del
 * registro del 15, pero el sistema de entonces la ligó al consolidado del 16 y marcó "devuelto a
 * FedEx" en LOS DOS. El del 16 iba en ruta y FedEx lo reporta entregado ese mismo día.
 *
 * Qué hace, SOLO con esa devolución:
 *  1. Registro del 16: quita del historial el evento "Devolución registrada" que puso esa devolución
 *     y regresa su estatus al que tenía antes (en ruta). El estatus real de FedEx lo toma el motor
 *     al abrir el cierre de su ruta (o en la siguiente pasada del cron).
 *  2. Registro del 15: se queda "devuelto a FedEx" (era el devuelto de verdad).
 *  3. La devolución queda ligada al consolidado y registro del 15, con lo que cambió (para poder
 *     deshacerla después con autorización si hiciera falta).
 *  4. Bitácora en audit_log con el antes/después.
 *
 * Ingresos: la devolución no anuló ninguno (no se confirmó anulación), así que no se tocan.
 *
 * POR DEFECTO NO ESCRIBE NADA: solo lista lo que cambiaría. Se puede correr varias veces.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-devolucion-384096861505-2026-10.ts
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-devolucion-384096861505-2026-10.ts --apply --user <userId>
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { AppDataSource as ds } from '../src/data-source';

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? 'true' : def;
};
const APPLY = process.argv.includes('--apply');
const USER_ID = arg('user') ?? null;
const TRACKING = '384096861505';
const DEVOLUTION_ID = arg('devolucion', '891a1765-dd87-40ef-a395-fb7bd2f0b977')!;
const KEEP_CONS = arg('cons-devuelto', '24f6e5ce-ae4b-49a5-96d3-a30c4f127f43')!; // consolidado 36415102026 (15-oct)
const NOTE_PREFIX = 'Devolución registrada';
const REASON = 'Devolución del registro del 15-oct se aplicó también al del 16-oct, que iba en ruta (fix 2026-10-17)';

interface Rec { id: string; status: string; consolidatedId: string; consNumber: string; createdAt: Date }

async function main() {
  if (APPLY && !USER_ID) throw new Error('Con --apply indica --user <userId> para la bitácora.');
  await ds.initialize();
  try {
    const [dev] = await ds.query(
      `SELECT id, trackingNumber, consolidatedId, shipmentId, date, undoneAt, appliedChanges, subsidiaryId FROM devolution WHERE id = ?`,
      [DEVOLUTION_ID],
    );
    if (!dev) throw new Error(`No existe la devolución ${DEVOLUTION_ID}.`);
    if (dev.trackingNumber !== TRACKING) throw new Error(`La devolución ${DEVOLUTION_ID} no es de la guía ${TRACKING}.`);
    if (dev.undoneAt) throw new Error('Esa devolución ya está deshecha; no hay nada que reparar.');

    const recs: Rec[] = await ds.query(
      `SELECT s.id, s.status, s.consolidatedId, COALESCE(c.consNumber, s.consNumber) AS consNumber, s.createdAt
         FROM shipment s LEFT JOIN consolidated c ON c.id = s.consolidatedId
        WHERE s.trackingNumber = ? AND s.active = 1 ORDER BY s.createdAt`,
      [TRACKING],
    );
    const keep = recs.find((r) => r.consolidatedId === KEEP_CONS);
    if (!keep) throw new Error(`No encontré el registro del consolidado ${KEEP_CONS}.`);
    const others = recs.filter((r) => r.id !== keep.id && new Date(r.createdAt) > new Date(keep.createdAt));

    console.log(`Guía ${TRACKING} — devolución ${DEVOLUTION_ID} (fecha ${new Date(dev.date).toISOString()})`);
    console.log(`  Se queda devuelto: ${keep.id} (cons ${keep.consNumber}, estatus ${keep.status})`);

    const plan: { id: string; consNumber: string; from: string; to: string; historyRows: number }[] = [];
    for (const r of others) {
      const [{ n }] = await ds.query(
        `SELECT COUNT(*) AS n FROM shipment_status WHERE shipmentId = ? AND status = 'devuelto_a_fedex' AND timestamp = ? AND notes LIKE ?`,
        [r.id, dev.date, `${NOTE_PREFIX}%`],
      );
      const [prev] = await ds.query(
        `SELECT status FROM shipment_status
          WHERE shipmentId = ? AND NOT (status = 'devuelto_a_fedex' AND timestamp = ? AND notes LIKE ?)
          ORDER BY timestamp DESC, createdAt DESC LIMIT 1`,
        [r.id, dev.date, `${NOTE_PREFIX}%`],
      );
      if (r.status !== 'devuelto_a_fedex') {
        console.log(`  ${r.id} (cons ${r.consNumber}) ya no está devuelto (${r.status}); no se toca.`);
        continue;
      }
      plan.push({ id: r.id, consNumber: r.consNumber, from: r.status, to: prev?.status ?? 'en_ruta', historyRows: Number(n) });
    }
    for (const p of plan) {
      console.log(`  Regresa ${p.id} (cons ${p.consNumber}): ${p.from} → ${p.to}; se quitan ${p.historyRows} evento(s) de devolución.`);
    }

    const [keepPrev] = await ds.query(
      `SELECT status FROM shipment_status
        WHERE shipmentId = ? AND NOT (status = 'devuelto_a_fedex' AND timestamp = ? AND notes LIKE ?)
        ORDER BY timestamp DESC, createdAt DESC LIMIT 1`,
      [keep.id, dev.date, `${NOTE_PREFIX}%`],
    );
    const applied = { records: [{ kind: 'shipment', id: keep.id, fromStatus: keepPrev?.status ?? keep.status }], annulledIncomeIds: [] };
    console.log(`  Devolución → consolidado ${keep.consNumber}, registro ${keep.id}.`);

    if (!APPLY) {
      console.log('\n(Vista previa: no se escribió nada. Corre con --apply --user <userId> para aplicar.)');
      return;
    }

    const [user] = await ds.query(`SELECT id, email, name, lastName, role FROM user WHERE id = ?`, [USER_ID]);
    if (!user) throw new Error(`No existe el usuario ${USER_ID}.`);

    await ds.transaction(async (m) => {
      for (const p of plan) {
        await m.query(
          `DELETE FROM shipment_status WHERE shipmentId = ? AND status = 'devuelto_a_fedex' AND timestamp = ? AND notes LIKE ?`,
          [p.id, dev.date, `${NOTE_PREFIX}%`],
        );
        await m.query(`UPDATE shipment SET status = ? WHERE id = ?`, [p.to, p.id]);
      }
      await m.query(
        `UPDATE devolution SET consolidatedId = ?, shipmentId = ?, chargeShipmentId = NULL, appliedChanges = ? WHERE id = ?`,
        [keep.consolidatedId, keep.id, JSON.stringify(applied), DEVOLUTION_ID],
      );
      await m.query(
        `INSERT INTO audit_log (id, userId, userEmail, userName, role, module, action, result, severity, entityName, entityId,
                                description, beforeState, afterState, metadata, subsidiaryId, createdAt)
         VALUES (?, ?, ?, ?, ?, 'devoluciones', 'update', 'success', 'warning', 'Devolución (corrección)', ?, ?, ?, ?, ?, ?, NOW())`,
        [
          randomUUID(), user.id, user.email, [user.name, user.lastName].filter(Boolean).join(' ') || null, user.role,
          DEVOLUTION_ID,
          `Corrigió la devolución de la guía ${TRACKING}: queda en el consolidado ${keep.consNumber}; ${plan.length} registro(s) regresan a su estatus`.slice(0, 500),
          JSON.stringify({ devolucion: { consolidatedId: dev.consolidatedId, shipmentId: dev.shipmentId }, registros: plan.map((p) => ({ id: p.id, estatus: p.from })) }),
          JSON.stringify({ devolucion: { consolidatedId: keep.consolidatedId, shipmentId: keep.id }, registros: plan.map((p) => ({ id: p.id, estatus: p.to })) }),
          JSON.stringify({ script: 'scripts/reparar-devolucion-384096861505-2026-10.ts', motivo: REASON }),
          dev.subsidiaryId,
        ],
      );
    });
    console.log(`\n✅ Devolución corregida: ${plan.length} registro(s) regresados y bitácora guardada.`);
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
