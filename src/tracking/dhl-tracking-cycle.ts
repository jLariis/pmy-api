import { Logger } from '@nestjs/common';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { WhereParcelDhlService } from './where-parcel-dhl.service';

export interface DhlCycleSummary {
  /** Guías DHL consultadas en este ciclo. */
  polledActive: number;
  /** Guías cuyo estatus cambió/persistió. */
  updated: number;
  /** Compat: en WhereParcel no hay liberación de slots. Siempre 0. */
  released: number;
  /** Compat: en WhereParcel no hay alta previa. Siempre 0. */
  registered: number;
  /** Tope de guías a consultar por ciclo (presupuesto). */
  quotaCap: number;
  /** Llamadas usadas del mes tras el ciclo (de los headers/contadores). */
  quotaUsedAfter: number;
  durationMin: number;
  /** true si se omitió porque ya había un ciclo en curso (candado compartido). */
  skipped?: boolean;
}

/**
 * Candado a NIVEL PROCESO (módulo = singleton del runtime, aunque el servicio se
 * provea en varios módulos NestJS). Evita que el cron, el botón manual y los
 * dobles-clic disparen ciclos en paralelo → eso violaba el mínimo de 3s entre
 * llamadas de la cuenta y causaba 429 en cascada.
 */
let dhlCycleInFlight = false;

/**
 * Ciclo de tracking DHL vía WhereParcel. A diferencia de 17TRACK, WhereParcel
 * devuelve el estatus directo en cada POST /v2/track (sin register/delete), así
 * que el ciclo es simple:
 *
 *   1) Toma las guías DHL recientes NO terminales (hasta `pollCap`, presupuesto).
 *   2) Consulta su estatus en WhereParcel (lotes de 5) y persiste.
 *
 * Las terminales se excluyen solas en el siguiente ciclo (filtro por status).
 */
export async function runDhlTrackingCycle(
  shipmentService: ShipmentsService,
  whereParcel: WhereParcelDhlService,
  pollCap: number,
  logger: Logger,
): Promise<DhlCycleSummary> {
  const start = Date.now();
  const summary: DhlCycleSummary = {
    polledActive: 0,
    updated: 0,
    released: 0,
    registered: 0,
    quotaCap: pollCap,
    quotaUsedAfter: 0,
    durationMin: 0,
  };

  // Candado: si ya hay un ciclo corriendo, NO arrancamos otro (evita 429 por
  // llamadas concurrentes a WhereParcel).
  if (dhlCycleInFlight) {
    logger.warn('⏭️ [DHL/WhereParcel] Ya hay un ciclo en curso; se omite este disparo.');
    return { ...summary, skipped: true, quotaUsedAfter: whereParcel.getUsage().used };
  }
  dhlCycleInFlight = true;

  try {
  const active = await shipmentService.getDhlToPoll(pollCap);
  summary.polledActive = active.length;

  if (active.length > 0) {
    const numbers = active.map((a) => a.trackingNumber);
    const results = await whereParcel.fetchTrackingStatuses(numbers);
    const persisted = await shipmentService.persistDhlTrackingResults(results);
    summary.updated = persisted.updated.length;
    logger.log(`📦 [DHL/WhereParcel] Consultadas ${active.length} → actualizadas ${summary.updated}.`);
  } else {
    logger.log('📭 [DHL/WhereParcel] No hay guías DHL activas por consultar.');
  }

  summary.quotaUsedAfter = whereParcel.getUsage().used;
  summary.durationMin = Number(((Date.now() - start) / 1000 / 60).toFixed(2));
  logger.log(
    `🏁 [DHL/WhereParcel] Ciclo finalizado en ${summary.durationMin} min. Uso del mes ≈ ${summary.quotaUsedAfter}.`,
  );
  return summary;
  } finally {
    dhlCycleInFlight = false;
  }
}

/**
 * Ciclo de REGISTRO a webhooks: toma guías DHL pendientes (recientes, no
 * terminales, con dhlUniqueId, sin registrar) y las suscribe en WhereParcel
 * (push). Es el mecanismo PRINCIPAL: tras registrar, WhereParcel empuja los
 * cambios de estatus a nuestro callback (sin polling). Idempotente: las ya
 * registradas se marcan con `seventeenRegisteredAt` y no se vuelven a tomar.
 */
let dhlRegInFlight = false;

export async function runDhlWebhookRegistrationCycle(
  shipmentService: ShipmentsService,
  whereParcel: WhereParcelDhlService,
  cap: number,
  logger: Logger,
): Promise<{ pending: number; registered: number; failed: number; skipped?: boolean }> {
  // Candado: evita que el registro manual (setup) y el cron se solapen y registren
  // doble (doble costo + posibles 429).
  if (dhlRegInFlight) {
    logger.warn('⏭️ [DHL/webhook] Ya hay un registro en curso; se omite este disparo.');
    return { pending: 0, registered: 0, failed: 0, skipped: true };
  }
  dhlRegInFlight = true;

  try {
  const pending = await shipmentService.getDhlToRegisterForWebhook(cap);
  if (pending.length === 0) {
    logger.log('✅ [DHL/webhook] No hay guías nuevas por registrar.');
    return { pending: 0, registered: 0, failed: 0 };
  }
  const items = pending.map((p) => ({ trackingNumber: p.trackingNumber, clientId: p.id }));
  const { registered, failed } = await whereParcel.registerForWebhooks(items);

  // Marca como registradas (por id) solo las que sí quedaron.
  const idByTn = new Map(pending.map((p) => [p.trackingNumber, p.id]));
  const ids = registered.map((tn) => idByTn.get(tn)).filter(Boolean) as string[];
  await shipmentService.markDhlWebhookRegistered(ids);

  logger.log(`📡 [DHL/webhook] Registradas ${registered.length}/${pending.length} (fallidas ${failed.length}).`);
  return { pending: pending.length, registered: registered.length, failed: failed.length };
  } finally {
    dhlRegInFlight = false;
  }
}
