/**
 * Llena el historial de FedEx de las cargas F2 dadas de alta sin él (2026-10-13).
 *
 * Desde e6ac30a (07-oct-2026) la F2 dejó de heredar el historial del paquete del master, y el alta
 * "directa" (addChargeShipments) nunca lo guardaba: las cargas quedaron solo con "en ruta" + el
 * último estatus del cron. Este script consulta FedEx y agrega los eventos que falten, con el MISMO
 * mapeo que el master (processFedexScanEventsToStatusesResp + entregas fantasma). No cambia el
 * estatus de la carga (eso lo sigue haciendo el cron); solo agrega historial y el id FedEx si falta.
 *
 * POR DEFECTO NO ESCRIBE NADA.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/llenar-historial-f2-2026-10.ts
 *   npx ts-node -r tsconfig-paths/register scripts/llenar-historial-f2-2026-10.ts --desde 2026-10-07 --guia 384087398960
 *   npx ts-node -r tsconfig-paths/register scripts/llenar-historial-f2-2026-10.ts --apply
 *
 * Al final lista las guías que FedEx no reconoce (no se pueden actualizar solas; revisar el número).
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { AppDataSource as ds } from '../src/data-source';
import { ShipmentsService } from '../src/shipments/shipments.service';


const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? 'true' : def;
};
const APPLY = process.argv.includes('--apply');
const DESDE = arg('desde', '2026-10-07')!;
const GUIA = arg('guia') ?? null;


async function fedexToken(): Promise<string> {
  const res = await fetch(`${process.env.FEDEX_API_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: String(process.env.FEDEX_CLIENT_ID),
      client_secret: String(process.env.FEDEX_CLIENT_SECRET),
    }),
  });
  const json: any = await res.json();
  if (!json.access_token) throw new Error('FedEx no regresó token');
  return json.access_token;
}

async function main() {
  await ds.initialize();
  let token = await fedexToken();
  const trackPackage = async (trackingNumber: string) => {
    const call = () => fetch(`${process.env.FEDEX_API_URL}/track/v1/trackingnumbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] }),
    });
    let res = await call();
    if (res.status === 401) { token = await fedexToken(); res = await call(); }
    return res.json();
  };

  // Mismo mapeo que el alta del master / F2 (solo depende del logger).
  const svc = Object.create(ShipmentsService.prototype) as any;
  svc.logger = { log: () => undefined, warn: (m: string) => console.warn(m), error: (m: string) => console.error(m), debug: () => undefined };
  svc.fedexService = { trackPackage };

  try {
    const rows: { id: string; trackingNumber: string; fedexUniqueId: string | null; sucursal: string }[] = await ds.query(
      `SELECT cs.id, cs.trackingNumber, cs.fedexUniqueId, s.name AS sucursal
         FROM charge_shipment cs JOIN subsidiary s ON s.id = cs.subsidiaryId
        WHERE cs.active = 1 AND LOWER(cs.shipmentType) = 'fedex' AND cs.createdAt >= ?
          ${GUIA ? 'AND cs.trackingNumber = ?' : ''}
        ORDER BY cs.createdAt`,
      GUIA ? [DESDE, GUIA] : [DESDE],
    );
    console.log(`Cargas F2 desde ${DESDE}: ${rows.length}`);

    const notFound: { guia: string; sucursal: string }[] = [];
    let toInsert = 0;
    let touched = 0;
    for (let i = 0; i < rows.length; i += 10) {
      const chunk = rows.slice(i, i + 10);
      const results = await Promise.all(chunk.map((r) => svc.fetchChargeFedexHistory(r.trackingNumber)));
      for (let k = 0; k < chunk.length; k++) {
        const cs = chunk[k];
        const fx = results[k];
        if (!fx.found) { notFound.push({ guia: cs.trackingNumber, sucursal: cs.sucursal }); continue; }
        const existing: { status: string; ts: string }[] = await ds.query(
          `SELECT status, DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i') AS ts FROM shipment_status WHERE chargeShipmentId = ?`,
          [cs.id],
        );
        const have = new Set(existing.map((e) => `${e.status}|${e.ts}`));
        const fmt = (d: Date) => new Date(d).toISOString().slice(0, 16).replace('T', ' ');
        const missing = fx.histories.filter((h: any) => !have.has(`${h.status}|${fmt(h.timestamp)}`));
        if (!missing.length && cs.fedexUniqueId) continue;
        touched++;
        toInsert += missing.length;
        if (!APPLY) continue;
        await ds.transaction(async (m) => {
          for (const h of missing) {
            await m.query(
              `INSERT INTO shipment_status (id, status, exceptionCode, timestamp, notes, chargeShipmentId, shipmentId, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, NULL, NOW())`,
              [randomUUID(), h.status, h.exceptionCode ?? '', new Date(h.timestamp), String(h.notes ?? '').slice(0, 255), cs.id],
            );
          }
          if (!cs.fedexUniqueId && fx.fedexUniqueId) {
            await m.query(`UPDATE charge_shipment SET fedexUniqueId = ?, carrierCode = COALESCE(carrierCode, ?) WHERE id = ?`, [fx.fedexUniqueId, fx.carrierCode, cs.id]);
          }
        });
      }
      process.stdout.write(`\r${Math.min(i + 10, rows.length)}/${rows.length}`);
    }
    console.log(`\nCargas a completar: ${touched} · eventos FedEx a agregar: ${toInsert}`);
    if (notFound.length) {
      console.log(`FedEx NO reconoce ${notFound.length} guías (revisar el número):`);
      console.table(notFound);
    }
    console.log(APPLY ? '✅ Aplicado.' : 'Ensayo: no se escribió nada. Usa --apply para aplicar.');
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
