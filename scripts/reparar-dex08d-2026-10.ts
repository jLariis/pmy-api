/**
 * Reparación del código FedEx "08D" (caso Hermosillo, ruta 589643647394, sábado 17-oct-2026).
 *
 * "08D" es el mismo DEX08 (cliente no disponible), pero el sistema comparaba el código exacto '08':
 * el cierre se saltó la regla de 3 visitas y cobró 5 guías × $52 = $260 con UNA sola visita, y el
 * lector de cobros no encontró regla para '08D' (sin regla → cobra). Desde el fix el código se
 * normaliza al entrar (src/common/fedex-exception-code.util.ts); este script arregla lo ya guardado:
 *
 *  1. Ingresos vivos con nonDeliveryStatus '08D':
 *     - sin 3 días distintos con 08/08D en la misma semana ⇒ se ANULAN (baja lógica, como el Consolidador);
 *     - con 3 días ⇒ el cobro era bueno, solo se renombra el código a '08'.
 *  2. Historial (shipment_status / charge_shipment no aplica): exceptionCode '08D' → '08' y, si quedó
 *     como 'no_entregado', estatus → 'cliente_no_disponible' (mismo mapeo que el 08).
 * Bitácora en income_change_log (historial del Consolidador) y audit_log.
 *
 * POR DEFECTO NO ESCRIBE NADA: solo lista lo que cambiaría.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-dex08d-2026-10.ts
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-dex08d-2026-10.ts --apply --user <userId>
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { AppDataSource as ds } from '../src/data-source';
import { hasWeekWithThreeDex08Days } from '../src/common/dex08-week.util';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? 'true' : undefined;
};
const APPLY = process.argv.includes('--apply');
const USER_ID = arg('user') ?? null;
const ANNUL_REASON = 'DEX 08D = 08: no tenía 3 visitas en la misma semana; no se cobra (fix 2026-10-19)';
const RENAME_REASON = 'DEX 08D = 08: código normalizado (fix 2026-10-19)';

interface IncomeRow {
  id: string;
  trackingNumber: string;
  shipmentId: string | null;
  subsidiary: string;
  cost: string;
  date: Date;
}

async function main() {
  if (APPLY && !USER_ID) throw new Error('Con --apply hay que pasar --user <userId> (queda en la bitácora).');
  await ds.initialize();
  try {
    const incomes: IncomeRow[] = await ds.query(
      `SELECT i.id, i.trackingNumber, i.shipmentId, s.name AS subsidiary, i.cost, i.date
         FROM income i LEFT JOIN subsidiary s ON s.id = i.subsidiaryId
        WHERE i.active = 1 AND UPPER(TRIM(i.nonDeliveryStatus)) = '08D'
        ORDER BY i.date`,
    );

    const toAnnul: IncomeRow[] = [];
    const toRename: IncomeRow[] = [];
    for (const inc of incomes) {
      const visits: { timestamp: Date }[] = inc.shipmentId
        ? await ds.query(
          `SELECT timestamp FROM shipment_status WHERE shipmentId = ? AND UPPER(TRIM(exceptionCode)) IN ('08', '08D')`,
          [inc.shipmentId],
        )
        : [];
      const chargeable = hasWeekWithThreeDex08Days(visits.map((v) => new Date(v.timestamp)));
      (chargeable ? toRename : toAnnul).push(inc);
      console.log(
        `${chargeable ? 'RENOMBRAR' : 'ANULAR   '} ${inc.trackingNumber}  ${inc.subsidiary}  $${inc.cost}  ${new Date(inc.date).toISOString()}  (${visits.length} visita(s) 08/08D)`,
      );
    }

    const [{ n: historyRows }] = await ds.query(
      `SELECT COUNT(*) AS n FROM shipment_status WHERE UPPER(TRIM(exceptionCode)) = '08D'`,
    );
    const total = toAnnul.reduce((acc, r) => acc + Number(r.cost), 0);
    console.log(`\nIngresos a anular: ${toAnnul.length} ($${total.toFixed(2)}) · a renombrar: ${toRename.length} · filas de historial 08D: ${historyRows}`);

    if (!APPLY) {
      console.log('\nModo prueba: no se escribió nada. Corre con --apply --user <userId> para aplicar.');
      return;
    }

    await ds.transaction(async (m) => {
      for (const r of toAnnul) {
        await m.query(
          `UPDATE income SET active = 0, annulledAt = NOW(), annulledById = ?, updatedById = ?, updatedAt = NOW(), editReason = ?
            WHERE id = ? AND active = 1`,
          [USER_ID, USER_ID, ANNUL_REASON, r.id],
        );
        await m.query(
          `INSERT INTO income_change_log (id, incomeId, shipmentId, action, field, oldValue, newValue, reason, userId, createdAt)
           VALUES (?, ?, ?, 'delete', 'active', '1', '0', ?, ?, NOW())`,
          [randomUUID(), r.id, r.shipmentId, ANNUL_REASON, USER_ID],
        );
      }
      for (const r of toRename) {
        await m.query(
          `UPDATE income SET nonDeliveryStatus = '08', updatedById = ?, updatedAt = NOW(), editReason = ? WHERE id = ?`,
          [USER_ID, RENAME_REASON, r.id],
        );
        await m.query(
          `INSERT INTO income_change_log (id, incomeId, shipmentId, action, field, oldValue, newValue, reason, userId, createdAt)
           VALUES (?, ?, ?, 'fix', 'nonDeliveryStatus', '08D', '08', ?, ?, NOW())`,
          [randomUUID(), r.id, r.shipmentId, RENAME_REASON, USER_ID],
        );
      }
      await m.query(
        `UPDATE shipment_status
            SET status = IF(status = 'no_entregado', 'cliente_no_disponible', status), exceptionCode = '08'
          WHERE UPPER(TRIM(exceptionCode)) = '08D'`,
      );
      await m.query(
        `INSERT INTO audit_log (id, userId, userName, module, action, result, severity, entityName, description, metadata, createdAt)
         VALUES (?, ?, 'Reparación 08D 2026-10', 'consolidados', 'update', 'success', 'warning', 'Ingresos', ?, ?, NOW())`,
        [
          randomUUID(),
          USER_ID,
          `DEX 08D normalizado a 08: ${toAnnul.length} ingreso(s) anulado(s) ($${total.toFixed(2)}), ${toRename.length} renombrado(s), ${historyRows} fila(s) de historial.`,
          JSON.stringify({ annulled: toAnnul.map((r) => r.trackingNumber), renamed: toRename.map((r) => r.trackingNumber) }),
        ],
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
