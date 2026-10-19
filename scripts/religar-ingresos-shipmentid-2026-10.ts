/**
 * Religa ingresos de paquete que quedaron con shipmentId = NULL (19-oct-2026).
 *
 * El commit 103cb0a (perf del cierre) agregó `Income.shipmentId` con `insert: false`; TypeORM funde
 * esa columna con la de la relación `shipment` y desde el despliegue NINGÚN ingreso nuevo guardaba
 * su paquete (cron, cierre, consolidador…). El ingreso sí suma en reportes, pero las pantallas que
 * buscan por paquete (cierre, Consolidador, devoluciones) lo ven "sin ingreso" y el candado
 * anti-duplicado por paquete no lo encuentra. Caso: 20 guías de Constitución, ruta 624541825820.
 *
 * Para cada ingreso sourceType='shipment', shipmentId NULL, creado desde --desde (default el
 * despliegue, 2026-10-19 05:00Z): busca el registro de la MISMA guía y MISMA sucursal (activo).
 *  - uno solo ⇒ se liga;
 *  - varios ⇒ el más reciente creado antes del ingreso (se reporta para revisar);
 *  - ninguno ⇒ se reporta y no se toca.
 * No cambia monto, fecha, tipo ni sucursal. Bitácora en income_change_log (historial del Consolidador).
 *
 * POR DEFECTO NO ESCRIBE NADA: solo lista lo que cambiaría.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/religar-ingresos-shipmentid-2026-10.ts
 *   npx ts-node -r tsconfig-paths/register scripts/religar-ingresos-shipmentid-2026-10.ts --apply --user <userId>
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
const SINCE = arg('desde') ?? '2026-10-19 05:00:00';
const REASON = 'Ingreso religado a su paquete (shipmentId quedó vacío por bug del 19-oct-2026)';

interface Row { id: string; trackingNumber: string; subsidiaryId: string; subsidiary: string; cost: string; createdAt: Date }
interface Candidate { id: string; createdAt: Date }

async function main() {
  if (APPLY && !USER_ID) throw new Error('Con --apply hay que pasar --user <userId> (queda en la bitácora).');
  await ds.initialize();
  try {
    const incomes: Row[] = await ds.query(
      `SELECT i.id, i.trackingNumber, i.subsidiaryId, s.name AS subsidiary, i.cost, i.createdAt
         FROM income i LEFT JOIN subsidiary s ON s.id = i.subsidiaryId
        WHERE i.sourceType = 'shipment' AND i.shipmentId IS NULL AND i.createdAt >= ?
        ORDER BY s.name, i.createdAt`,
      [SINCE],
    );

    const links: { incomeId: string; shipmentId: string }[] = [];
    let ambiguous = 0;
    let missing = 0;
    for (const inc of incomes) {
      const cands: Candidate[] = await ds.query(
        `SELECT id, createdAt FROM shipment
          WHERE trackingNumber = ? AND subsidiaryId = ? AND active = 1
          ORDER BY createdAt DESC`,
        [inc.trackingNumber, inc.subsidiaryId],
      );
      const pick = cands.find((c) => new Date(c.createdAt) <= new Date(inc.createdAt)) ?? null;
      if (!pick) {
        missing++;
        console.log(`SIN PAQUETE  ${inc.trackingNumber}  ${inc.subsidiary}  $${inc.cost}`);
        continue;
      }
      if (cands.length > 1) {
        ambiguous++;
        console.log(`REVISAR      ${inc.trackingNumber}  ${inc.subsidiary}  ${cands.length} registros → el más reciente ${pick.id}`);
      }
      links.push({ incomeId: inc.id, shipmentId: pick.id });
    }

    const bySub = new Map<string, number>();
    for (const r of incomes) bySub.set(r.subsidiary, (bySub.get(r.subsidiary) ?? 0) + 1);
    console.log(`\nIngresos sin paquete desde ${SINCE}: ${incomes.length}`);
    for (const [s, n] of bySub) console.log(`  ${s}: ${n}`);
    console.log(`A religar: ${links.length} · a revisar (varios registros): ${ambiguous} · sin paquete: ${missing}`);

    if (!APPLY) {
      console.log('\nModo prueba: no se escribió nada. Corre con --apply --user <userId> para aplicar.');
      return;
    }

    await ds.transaction(async (m) => {
      for (const l of links) {
        await m.query(
          `UPDATE income SET shipmentId = ?, updatedById = ?, updatedAt = NOW(), editReason = ? WHERE id = ? AND shipmentId IS NULL`,
          [l.shipmentId, USER_ID, REASON, l.incomeId],
        );
        await m.query(
          `INSERT INTO income_change_log (id, incomeId, shipmentId, action, field, oldValue, newValue, reason, userId, createdAt)
           VALUES (?, ?, ?, 'fix', 'shipmentId', NULL, ?, ?, ?, NOW())`,
          [randomUUID(), l.incomeId, l.shipmentId, l.shipmentId, REASON, USER_ID],
        );
      }
      await m.query(
        `INSERT INTO audit_log (id, userId, userName, module, action, result, severity, entityName, description, metadata, createdAt)
         VALUES (?, ?, 'Religar ingresos 2026-10', 'consolidados', 'update', 'success', 'warning', 'Ingresos', ?, ?, NOW())`,
        [randomUUID(), USER_ID, `${links.length} ingreso(s) religado(s) a su paquete (shipmentId vacío desde ${SINCE}).`, JSON.stringify({ since: SINCE, count: links.length })],
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
