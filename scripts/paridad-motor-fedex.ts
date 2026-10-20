/**
 * Evaluación del motor FedEx nuevo (piloto por sucursal, p. ej. Cabo). SOLO LECTURA.
 *
 *  1. Estatus en sombra: % de guías en que el motor coincide con el legacy, por día y sucursal
 *     (sucursales FUERA del piloto, que se siguen observando).
 *  2. Cobros en sombra: lo que el motor cobraría vs el ingreso real de esa guía en esa semana.
 *  3. Piloto: ingresos que creó el motor (con sourceEventKey) y cobros dobles por guía y semana.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/paridad-motor-fedex.ts
 *   npx ts-node -r tsconfig-paths/register scripts/paridad-motor-fedex.ts --desde 2026-10-20 --sucursal "Cabo San Lucas"
 */
import 'dotenv/config';
import { AppDataSource as ds } from '../src/data-source';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SINCE = arg('desde') ?? new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
const SUB = arg('sucursal') ?? 'Cabo San Lucas';
const H = (d: string) => `DATE(${d} - INTERVAL 7 HOUR)`; // día Hermosillo

async function main() {
  await ds.initialize();
  try {
    const [sub] = await ds.query(`SELECT id, name FROM subsidiary WHERE name = ?`, [SUB]);
    if (!sub) throw new Error(`No existe la sucursal "${SUB}"`);
    console.log(`\nEvaluación del motor FedEx desde ${SINCE} · piloto: ${sub.name}\n`);

    console.log('1) ESTATUS EN SOMBRA (coincide con el legacy)');
    console.table(await ds.query(
      `SELECT ${H('o.createdAt')} AS dia, s.name AS sucursal, COUNT(*) AS observaciones,
              ROUND(100 * AVG(o.matchesLegacy), 1) AS pctIgual
         FROM tracking_sync_observation o
         JOIN shipment sh ON sh.id = o.shipmentId JOIN subsidiary s ON s.id = sh.subsidiaryId
        WHERE o.createdAt >= ? GROUP BY 1, 2 ORDER BY 1, 2`,
      [SINCE],
    ));

    console.log('2) COBROS EN SOMBRA (lo que cobraría el motor vs lo que existe)');
    console.table(await ds.query(
      `SELECT s.name AS sucursal, p.incomeType AS tipo,
              COUNT(*) AS cobrosMotor,
              SUM(EXISTS (SELECT 1 FROM income i WHERE i.shipmentId = p.shipmentId AND i.active = 1
                           AND YEARWEEK(i.date, 3) = YEARWEEK(p.occurredAt, 3))) AS conIngresoEsaSemana,
              SUM(NOT EXISTS (SELECT 1 FROM income i WHERE i.shipmentId = p.shipmentId AND i.active = 1
                           AND YEARWEEK(i.date, 3) = YEARWEEK(p.occurredAt, 3))) AS legacyNoCobro,
              SUM(p.cost) AS monto
         FROM (SELECT o.shipmentId, o.subsidiaryId, o.incomeType, MAX(o.occurredAt) AS occurredAt, MAX(o.cost) AS cost
                 FROM tracking_sync_income_observation o WHERE o.createdAt >= ?
                GROUP BY o.shipmentId, o.subsidiaryId, o.incomeType, YEARWEEK(o.occurredAt, 3)) p
         JOIN subsidiary s ON s.id = p.subsidiaryId
        GROUP BY 1, 2 ORDER BY 1, 2`,
      [SINCE],
    ));
    console.log('   (legacyNoCobro = el motor cobraría y hoy no hay ingreso: revisar caso por caso)');

    console.log(`\n3) PILOTO ${sub.name}`);
    console.table(await ds.query(
      `SELECT ${H('i.createdAt')} AS dia,
              SUM(i.sourceEventKey IS NOT NULL) AS creadosPorMotor,
              SUM(i.sourceEventKey IS NULL) AS creadosPorLegacyOCierre,
              SUM(CASE WHEN i.sourceEventKey IS NOT NULL THEN i.cost ELSE 0 END) AS montoMotor
         FROM income i
        WHERE i.subsidiaryId = ? AND i.sourceType = 'shipment' AND i.active = 1 AND i.createdAt >= ?
        GROUP BY 1 ORDER BY 1`,
      [sub.id, SINCE],
    ));
    const dobles = await ds.query(
      `SELECT i.trackingNumber AS guia, YEARWEEK(i.date, 3) AS semana, COUNT(*) AS ingresos,
              GROUP_CONCAT(CONCAT(i.incomeType, IF(i.sourceEventKey IS NULL, '(legacy/cierre)', '(motor)')) SEPARATOR ', ') AS detalle
         FROM income i
        WHERE i.subsidiaryId = ? AND i.sourceType = 'shipment' AND i.active = 1 AND i.createdAt >= ?
        GROUP BY i.shipmentId, i.trackingNumber, YEARWEEK(i.date, 3) HAVING COUNT(*) > 1`,
      [sub.id, SINCE],
    );
    console.log(`Cobros dobles (misma guía y semana): ${dobles.length}`);
    if (dobles.length) console.table(dobles);

    console.log('Convivencia: revisa en el log del servidor la línea "[legacy] convivencia: N guías ... motor nuevo" en cada corrida horaria.');
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
