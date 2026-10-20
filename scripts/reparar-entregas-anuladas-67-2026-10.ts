/**
 * Repara entregas que la regla de "entrega fantasma" anuló por un 67/44 posterior (Cabo, 14–19 oct
 * 2026; ruta 439565284120 del 19-oct). FedEx manda el escaneo 67 con la hora adelantada (~1 h): el
 * cron guardaba la entrega como "en tránsito" y NO cobraba, aunque la guía quedó "entregado".
 * Entregado es final (regla del usuario); el fix está en src/common/phantom-delivery.util.ts.
 *
 * Para cada guía en "entregado", en una ruta NO 31.5, SIN ingreso vivo, cuya fila "Delivered" quedó
 * como en_transito con un 67/44 posterior (≤ 6 h):
 *  - crea su ingreso ENTREGADO (costo FedEx de la sucursal, fecha = hora de la entrega, ligado al paquete);
 *  - pasa esa fila del historial de en_transito a entregado (el 67/44 se queda tal cual: trazabilidad).
 * Bitácora en income_change_log y audit_log.
 *
 * POR DEFECTO NO ESCRIBE NADA: solo lista lo que cambiaría.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-entregas-anuladas-67-2026-10.ts
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-entregas-anuladas-67-2026-10.ts --apply --user <userId>
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { AppDataSource as ds } from '../src/data-source';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? 'true' : undefined;
};
const APPLY = process.argv.includes('--apply');
const USER_ID = arg('user') ?? null;
const SINCE = arg('desde') ?? '2026-10-01';
const REASON = 'Entrega anulada por 67/44 con hora adelantada; entregado es final (fix 2026-10-19)';

interface Row {
  shipmentId: string;
  trackingNumber: string;
  subsidiaryId: string;
  subsidiary: string;
  cost: string;
  historyId: string;
  deliveredAt: Date;
  route: string;
}

async function main() {
  if (APPLY && !USER_ID) throw new Error('Con --apply hay que pasar --user <userId> (queda en la bitácora).');
  await ds.initialize();
  try {
    const rows: Row[] = await ds.query(
      `SELECT sh.id AS shipmentId, sh.trackingNumber, sh.subsidiaryId, s.name AS subsidiary, s.fedexCostPackage AS cost,
              ph.id AS historyId, ph.timestamp AS deliveredAt,
              (SELECT GROUP_CONCAT(pd.trackingNumber) FROM package_dispatch_history h
                 JOIN package_dispatch pd ON pd.id = h.dispatchId WHERE h.shipmentId = sh.id) AS route
         FROM shipment_status ph
         JOIN shipment sh ON sh.id = ph.shipmentId
         JOIN subsidiary s ON s.id = sh.subsidiaryId
        WHERE ph.status = 'en_transito' AND ph.notes LIKE 'Delivered%' AND ph.timestamp >= ?
          AND sh.status = 'entregado' AND sh.active = 1 AND sh.shipmentType = 'fedex'
          AND EXISTS (SELECT 1 FROM shipment_status s67 WHERE s67.shipmentId = sh.id
                        AND s67.exceptionCode IN ('67','44') AND s67.timestamp > ph.timestamp
                        AND s67.timestamp <= ph.timestamp + INTERVAL 6 HOUR)
          AND EXISTS (SELECT 1 FROM package_dispatch_history h JOIN package_dispatch pd ON pd.id = h.dispatchId
                       WHERE h.shipmentId = sh.id AND pd.is315 = 0)
          AND NOT EXISTS (SELECT 1 FROM income i WHERE i.shipmentId = sh.id AND i.active = 1)
        ORDER BY s.name, ph.timestamp`,
      [SINCE],
    );

    for (const r of rows) {
      console.log(`${r.trackingNumber}  ${r.subsidiary}  ruta ${r.route}  entregada ${new Date(r.deliveredAt).toISOString()}  $${r.cost}`);
    }
    const total = rows.reduce((acc, r) => acc + Number(r.cost), 0);
    console.log(`\nEntregas a reparar: ${rows.length} · ingreso a crear: $${total.toFixed(2)}`);

    if (!APPLY) {
      console.log('\nModo prueba: no se escribió nada. Corre con --apply --user <userId> para aplicar.');
      return;
    }

    await ds.transaction(async (m) => {
      for (const r of rows) {
        const incomeId = randomUUID();
        await m.query(
          `INSERT INTO income (id, trackingNumber, shipmentType, cost, incomeType, nonDeliveryStatus, isGrouped, sourceType,
                               date, createdAt, subsidiaryId, shipmentId, createdById, active, editReason)
           VALUES (?, ?, 'fedex', ?, 'entregado', NULL, 0, 'shipment', ?, NOW(), ?, ?, ?, 1, ?)`,
          [incomeId, r.trackingNumber, r.cost, r.deliveredAt, r.subsidiaryId, r.shipmentId, USER_ID, REASON],
        );
        await m.query(`UPDATE shipment_status SET status = 'entregado' WHERE id = ? AND status = 'en_transito'`, [r.historyId]);
        await m.query(
          `INSERT INTO income_change_log (id, incomeId, shipmentId, action, field, oldValue, newValue, reason, userId, createdAt)
           VALUES (?, ?, ?, 'income_repair', 'incomeType', NULL, 'entregado', ?, ?, NOW())`,
          [randomUUID(), incomeId, r.shipmentId, REASON, USER_ID],
        );
      }
      await m.query(
        `INSERT INTO audit_log (id, userId, userName, module, action, result, severity, entityName, description, metadata, createdAt)
         VALUES (?, ?, 'Reparación entregas 67', 'consolidados', 'update', 'success', 'warning', 'Ingresos', ?, ?, NOW())`,
        [randomUUID(), USER_ID, `${rows.length} entrega(s) anuladas por 67/44 reparadas ($${total.toFixed(2)}).`,
          JSON.stringify({ guias: rows.map((r) => r.trackingNumber) })],
      );
    });
    console.log('\nAplicado.');
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
