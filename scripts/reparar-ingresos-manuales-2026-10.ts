/**
 * Reparación de ingresos "Manual (otro)" capturados con guía (caso 878249671370, ruta 604005759064,
 * Hermosillo, 10-oct-2026).
 *
 * Un ingreso con sourceType='manual' no suma en ningún reporte (dashboard, Excel, Finanzas →
 * Ingresos, KPIs): la regla única `isCountableIncome` lo deja fuera. Desde el fix, el Consolidador
 * liga el alta manual a la guía; este script hace lo mismo con los que ya se capturaron:
 * sourceType → 'shipment', shipmentId → registro más reciente de la guía, shipmentType del registro.
 * No cambia monto, fecha, sucursal ni tipo. Bitácora en income_change_log (historial del Consolidador).
 *
 * POR DEFECTO NO ESCRIBE NADA: solo lista lo que cambiaría.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-ingresos-manuales-2026-10.ts
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-ingresos-manuales-2026-10.ts --guia 878249671370
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-ingresos-manuales-2026-10.ts --apply --user <userId>
 *
 * Se OMITE (y se reporta) si ese registro (shipment) ya tiene un ingreso vivo del mismo tipo: ligarlo
 * lo cobraría dos veces; se revisa a mano en el Consolidador. Ingresos de OTRO registro de la guía
 * (consolidado anterior) no cuentan: el ingreso es por shipment.
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
const GUIA = arg('guia') ?? null;
const REASON = 'Ingreso manual con guía ligado a su registro para que cuente en reportes (fix 2026-10-13)';

interface Candidate {
  incomeId: string;
  trackingNumber: string;
  subsidiaryId: string;
  incomeType: string;
  cost: string;
  date: string;
  shipmentId: string | null;
  shipmentType: string | null;
  duplicates: number;
}

async function main() {
  if (APPLY && !USER_ID) throw new Error('Con --apply indica --user <userId> para la bitácora.');
  await ds.initialize();
  try {
    const rows: Candidate[] = await ds.query(
      `SELECT x.*,
              (SELECT COUNT(*) FROM income o WHERE o.active = 1 AND o.sourceType = 'shipment'
                AND o.incomeType = x.incomeType AND o.id <> x.incomeId
                AND (o.shipmentId = x.shipmentId OR (o.shipmentId IS NULL AND o.trackingNumber = x.trackingNumber))) AS duplicates
         FROM (
       SELECT i.id AS incomeId, i.trackingNumber, i.subsidiaryId, i.incomeType, i.cost, i.date,
              (SELECT s.id FROM shipment s WHERE s.trackingNumber = i.trackingNumber AND s.active = 1
                ORDER BY s.createdAt DESC LIMIT 1) AS shipmentId,
              (SELECT s.shipmentType FROM shipment s WHERE s.trackingNumber = i.trackingNumber AND s.active = 1
                ORDER BY s.createdAt DESC LIMIT 1) AS shipmentType
         FROM income i
        WHERE i.sourceType = 'manual' AND i.active = 1
          AND i.trackingNumber IS NOT NULL AND i.trackingNumber <> ''
          ${GUIA ? 'AND i.trackingNumber = ?' : ''}
       ) x
        ORDER BY x.date`,
      GUIA ? [GUIA] : [],
    );

    const toFix = rows.filter((r) => r.shipmentId && Number(r.duplicates) === 0);
    const noShipment = rows.filter((r) => !r.shipmentId);
    const dup = rows.filter((r) => r.shipmentId && Number(r.duplicates) > 0);

    console.log(`Ingresos manuales con guía: ${rows.length}`);
    console.log(`  A ligar: ${toFix.length}`);
    console.table(toFix.map((r) => ({ guia: r.trackingNumber, monto: r.cost, fecha: r.date, tipo: r.incomeType, shipment: r.shipmentId })));
    if (noShipment.length) {
      console.log(`  Sin registro de la guía (se quedan como manual): ${noShipment.length}`);
      console.table(noShipment.map((r) => ({ guia: r.trackingNumber, monto: r.cost, fecha: r.date })));
    }
    if (dup.length) {
      console.log(`  REVISAR a mano (ese registro ya tiene ingreso vivo del mismo tipo): ${dup.length}`);
      console.table(dup.map((r) => ({ guia: r.trackingNumber, monto: r.cost, fecha: r.date, income: r.incomeId })));
    }

    if (!APPLY) {
      console.log('\nEnsayo: no se escribió nada. Usa --apply --user <userId> para aplicar.');
      return;
    }

    await ds.transaction(async (m) => {
      for (const r of toFix) {
        await m.query(
          `UPDATE income SET sourceType = 'shipment', shipmentId = ?, shipmentType = COALESCE(?, shipmentType),
                  updatedById = ?, updatedAt = NOW()
            WHERE id = ? AND sourceType = 'manual' AND active = 1`,
          [r.shipmentId, r.shipmentType, USER_ID, r.incomeId],
        );
        await m.query(
          `INSERT INTO income_change_log (id, incomeId, shipmentId, action, field, oldValue, newValue, reason, userId, createdAt)
           VALUES (?, ?, ?, 'manual_link', 'sourceType', 'manual', 'shipment', ?, ?, NOW())`,
          [randomUUID(), r.incomeId, r.shipmentId, REASON, USER_ID],
        );
      }
    });
    console.log(`\n✅ ${toFix.length} ingresos ligados a su guía.`);
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
