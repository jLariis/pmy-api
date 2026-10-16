/**
 * Reparación del traspaso de bodega del 13-oct-2026 18:22 (Mariana, 109 guías) que se guardó con
 * destino = la misma Bodega Hermosillo (el selector autollenaba el destino). Las guías se quedaron
 * en Bodega Hermosillo y Puerto Peñasco no pudo sacarlas a ruta ("El paquete no pertenece a la
 * sucursal actual"). Son las 108 del "MANIFIESTO DE EMBARQUE PEÑASCO 14-10-26" + 878187485173, que
 * después se traspasó a Sonoyta y por eso este script la deja donde está.
 *
 * Qué hace, SOLO con los registros exactos de ese traspaso (los ids guardados en el outbound):
 *  1. Guías (shipment / charge_shipment) que SIGUEN en la bodega de origen → sucursal destino.
 *     No toca estatus ni historial: las entregadas siguen entregadas, el cron sigue igual. Las que
 *     ya están en otra sucursal (otro traspaso, botón "Traspasar") se reportan y no se tocan.
 *  2. Ingresos de esos registros (por shipmentId/chargeId, o por guía si el ingreso no tiene id)
 *     que estén en la bodega de origen → sucursal destino. Monto, fecha y tipo no cambian; si las
 *     tarifas de las dos sucursales son distintas se avisa para revisarlo en el Consolidador.
 *  3. El outbound queda con el destino correcto (historial, PDF y Excel).
 *  4. Bitácora: income_change_log por ingreso + un registro en audit_log con el antes/después.
 *
 * POR DEFECTO NO ESCRIBE NADA: solo lista lo que cambiaría. Se puede correr varias veces.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-traspaso-penasco-2026-10.ts
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-traspaso-penasco-2026-10.ts --apply --user <userId>
 *   (opcionales: --outbound <id> --destino <subsidiaryId>)
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
const OUTBOUND_ID = arg('outbound', 'b84cc245-ccb1-4ecd-a07c-d45c610cd6cc')!;
const DESTINATION_ID = arg('destino', '14fd04e9-9d6e-4593-bfe3-346026bafeb6')!; // Puerto Peñasco
const REASON = 'Traspaso 13-oct guardado hacia la misma bodega: se mueve a la sucursal real (fix 2026-10-15)';

interface OutboundPkg { id: string; trackingNumber: string; isCharge: boolean }
interface PkgRow { id: string; trackingNumber: string; status: string; subsidiaryId: string | null; isCharge: boolean; newer: number }
interface IncomeRow {
  id: string; trackingNumber: string | null; shipmentId: string | null; chargeId: string | null;
  sourceType: string; incomeType: string; cost: string; date: string; active: number; subsidiaryId: string;
}

const DELIVERED = ['entregado', 'entregado_por_fedex', 'entregado_en_bodega'];

async function main() {
  if (APPLY && !USER_ID) throw new Error('Con --apply indica --user <userId> para la bitácora.');
  await ds.initialize();
  try {
    const [outbound] = await ds.query(
      `SELECT id, type, warehouseId, destinationId, trackingNumber, shipments, createdAt FROM warehouse_outbound WHERE id = ?`,
      [OUTBOUND_ID],
    );
    if (!outbound) throw new Error(`No existe el traspaso ${OUTBOUND_ID}.`);
    if (outbound.type !== 'transfer') throw new Error(`El outbound ${OUTBOUND_ID} no es un traspaso.`);
    const originId: string = outbound.warehouseId;
    if (originId === DESTINATION_ID) throw new Error('El destino no puede ser la misma bodega de origen.');

    const subs: { id: string; name: string; fedexCostPackage: string; dhlCostPackage: string }[] = await ds.query(
      `SELECT id, name, fedexCostPackage, dhlCostPackage FROM subsidiary WHERE id IN (?, ?)`,
      [originId, DESTINATION_ID],
    );
    const origin = subs.find((s) => s.id === originId);
    const destination = subs.find((s) => s.id === DESTINATION_ID);
    if (!origin || !destination) throw new Error('No se encontró la sucursal de origen o la de destino.');

    const pkgs: OutboundPkg[] = (typeof outbound.shipments === 'string' ? JSON.parse(outbound.shipments) : outbound.shipments)
      .map((p: any) => ({ id: p.id, trackingNumber: p.trackingNumber, isCharge: p.isCharge === true || p.isCharge === 'true' }));
    const normalIds = pkgs.filter((p) => !p.isCharge).map((p) => p.id);
    const chargeIds = pkgs.filter((p) => p.isCharge).map((p) => p.id);

    // `newer` = registros más recientes de la misma guía (otro consolidado/carga): solo se reportan.
    const loadPkgs = async (table: 'shipment' | 'charge_shipment', ids: string[], isCharge: boolean): Promise<PkgRow[]> =>
      ids.length
        ? (await ds.query(
            `SELECT p.id, p.trackingNumber, p.status, p.subsidiaryId,
                    (SELECT COUNT(*) FROM ${table} n WHERE n.trackingNumber = p.trackingNumber AND n.createdAt > p.createdAt) AS newer
               FROM ${table} p WHERE p.id IN (?)`,
            [ids],
          )).map((r: any) => ({ ...r, isCharge, newer: Number(r.newer) }))
        : [];
    const rows = [...(await loadPkgs('shipment', normalIds, false)), ...(await loadPkgs('charge_shipment', chargeIds, true))];

    const toMove = rows.filter((r) => r.subsidiaryId === originId);
    const elsewhere = rows.filter((r) => r.subsidiaryId !== originId && r.subsidiaryId !== DESTINATION_ID);
    const already = rows.filter((r) => r.subsidiaryId === DESTINATION_ID);
    const missing = pkgs.filter((p) => !rows.some((r) => r.id === p.id));

    const moveShipmentIds = toMove.filter((r) => !r.isCharge).map((r) => r.id);
    const moveChargeIds = toMove.filter((r) => r.isCharge).map((r) => r.id);
    const moveTns = [...new Set(toMove.map((r) => r.trackingNumber))];

    // Ingresos de esos registros que siguen en la bodega de origen (vivos, anulados y reversas:
    // todos se mueven juntos para que el par ingreso/reversa no quede partido entre sucursales).
    const incomes: IncomeRow[] = toMove.length
      ? await ds.query(
          `SELECT i.id, i.trackingNumber, i.shipmentId, i.chargeId, i.sourceType, i.incomeType, i.cost, i.date, i.active, i.subsidiaryId
             FROM income i
            WHERE i.subsidiaryId = ?
              AND (${moveShipmentIds.length ? 'i.shipmentId IN (?)' : '0'}
                OR ${moveChargeIds.length ? 'i.chargeId IN (SELECT cs.chargeId FROM charge_shipment cs WHERE cs.id IN (?))' : '0'}
                OR (i.shipmentId IS NULL AND i.chargeId IS NULL AND i.trackingNumber IN (?)))
            ORDER BY i.date`,
          [originId, ...(moveShipmentIds.length ? [moveShipmentIds] : []), ...(moveChargeIds.length ? [moveChargeIds] : []), moveTns],
        )
      : [];

    const name = (id: string | null) => (id === originId ? origin.name : id === DESTINATION_ID ? destination.name : id ?? '—');
    console.log(`Traspaso ${outbound.id} (folio ${outbound.trackingNumber ?? '—'}, ${outbound.createdAt})`);
    console.log(`  Origen: ${origin.name} · destino guardado: ${name(outbound.destinationId)} · destino correcto: ${destination.name}`);
    console.log(`  Guías en el traspaso: ${pkgs.length}`);
    console.log(`  A mover a ${destination.name}: ${toMove.length} (ya entregadas: ${toMove.filter((r) => DELIVERED.includes(r.status)).length})`);
    console.table(toMove.map((r) => ({ guia: r.trackingNumber, carga: r.isCharge, estatus: r.status, registrosMasNuevos: r.newer })));
    if (already.length) console.log(`  Ya están en ${destination.name} (no se tocan): ${already.length}`);
    if (elsewhere.length) {
      console.log(`  En otra sucursal (no se tocan): ${elsewhere.length}`);
      console.table(elsewhere.map((r) => ({ guia: r.trackingNumber, estatus: r.status, sucursalId: r.subsidiaryId })));
    }
    if (missing.length) console.log(`  Registros del traspaso que ya no existen: ${missing.map((p) => p.trackingNumber).join(', ')}`);
    const withNewer = toMove.filter((r) => r.newer > 0);
    if (withNewer.length) {
      console.log(`  OJO: ${withNewer.length} guías tienen un registro más nuevo (otro consolidado/carga); ese no se toca.`);
    }

    console.log(`\n  Ingresos a mover a ${destination.name}: ${incomes.length} · total $${incomes.reduce((a, i) => a + Number(i.cost), 0).toFixed(2)}`);
    if (incomes.length) {
      console.table(incomes.map((i) => ({ guia: i.trackingNumber, tipo: i.incomeType, origen: i.sourceType, monto: i.cost, fecha: i.date, activo: i.active })));
    }
    if (origin.fedexCostPackage !== destination.fedexCostPackage || origin.dhlCostPackage !== destination.dhlCostPackage) {
      console.log(`  OJO: las tarifas son distintas (FedEx ${origin.fedexCostPackage} vs ${destination.fedexCostPackage}, DHL ${origin.dhlCostPackage} vs ${destination.dhlCostPackage}).`);
      console.log('       El monto NO se recalcula: revísalo en el Consolidador.');
    }

    if (!APPLY) {
      console.log('\nEnsayo: no se escribió nada. Usa --apply --user <userId> para aplicar.');
      return;
    }

    const [user] = await ds.query(`SELECT id, email, name, lastName, role FROM user WHERE id = ?`, [USER_ID]);
    if (!user) throw new Error(`No existe el usuario ${USER_ID}.`);

    await ds.transaction(async (m) => {
      // Se repite el filtro por origen en el UPDATE: si algo se movió entre el ensayo y ahora, no se pisa.
      if (moveShipmentIds.length) {
        await m.query(`UPDATE shipment SET subsidiaryId = ? WHERE id IN (?) AND subsidiaryId = ?`, [DESTINATION_ID, moveShipmentIds, originId]);
      }
      if (moveChargeIds.length) {
        await m.query(`UPDATE charge_shipment SET subsidiaryId = ? WHERE id IN (?) AND subsidiaryId = ?`, [DESTINATION_ID, moveChargeIds, originId]);
      }
      for (const i of incomes) {
        await m.query(
          `UPDATE income SET subsidiaryId = ?, updatedById = ?, updatedAt = NOW(), editReason = ? WHERE id = ? AND subsidiaryId = ?`,
          [DESTINATION_ID, USER_ID, REASON.slice(0, 255), i.id, originId],
        );
        await m.query(
          `INSERT INTO income_change_log (id, incomeId, shipmentId, action, field, oldValue, newValue, reason, userId, createdAt)
           VALUES (?, ?, ?, 'subsidiary_move', 'subsidiaryId', ?, ?, ?, ?, NOW())`,
          [randomUUID(), i.id, i.shipmentId, `${origin.name} (${originId})`.slice(0, 255), `${destination.name} (${DESTINATION_ID})`.slice(0, 255), REASON.slice(0, 255), USER_ID],
        );
      }
      await m.query(`UPDATE warehouse_outbound SET destinationId = ? WHERE id = ?`, [DESTINATION_ID, OUTBOUND_ID]);

      const description = `Corrigió traspaso ${outbound.trackingNumber ?? OUTBOUND_ID}: ${toMove.length} guías y ${incomes.length} ingresos de ${origin.name} a ${destination.name}`;
      await m.query(
        `INSERT INTO audit_log (id, userId, userEmail, userName, role, module, action, result, severity, entityName, entityId,
                                description, beforeState, afterState, metadata, subsidiaryId, createdAt)
         VALUES (?, ?, ?, ?, ?, 'bodega_salida', 'transfer', 'success', 'warning', 'Traspaso (corrección)', ?, ?, ?, ?, ?, ?, NOW())`,
        [
          randomUUID(), user.id, user.email, [user.name, user.lastName].filter(Boolean).join(' ') || null, user.role,
          OUTBOUND_ID, description.slice(0, 500),
          JSON.stringify({
            destinoGuardado: { id: outbound.destinationId, nombre: name(outbound.destinationId) },
            paquetes: toMove.map((r) => ({ id: r.id, guia: r.trackingNumber, carga: r.isCharge, estatus: r.status, sucursalAnteriorId: originId })),
            ingresos: incomes.map((i) => ({ id: i.id, guia: i.trackingNumber, monto: i.cost, fecha: i.date, sucursalAnteriorId: originId })),
          }),
          JSON.stringify({ destino: { id: DESTINATION_ID, nombre: destination.name }, paquetes: toMove.length, ingresos: incomes.length }),
          JSON.stringify({
            script: 'scripts/reparar-traspaso-penasco-2026-10.ts', motivo: REASON,
            noTocadas: { otraSucursal: elsewhere.map((r) => r.trackingNumber), yaEnDestino: already.map((r) => r.trackingNumber) },
          }),
          DESTINATION_ID,
        ],
      );
    });
    console.log(`\n✅ ${toMove.length} guías y ${incomes.length} ingresos movidos a ${destination.name}; traspaso corregido y bitácora guardada.`);
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
