import { Logger } from '@nestjs/common';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { SeventeenTrackDhlService } from './seventeen-track-dhl.service';

export interface DhlCycleSummary {
  polledActive: number;
  updated: number;
  released: number;
  registered: number;
  quotaCap: number;
  quotaUsedAfter: number;
  durationMin: number;
}

/**
 * Ciclo de RECICLAJE de quota 17TRACK para DHL. Reutilizable por el cron horario
 * y por el endpoint manual (`/shipments/dhl/sync-cron`). Recibe los servicios ya
 * inyectados para NO tocar la DI de ShipmentsService (que se instancia en varios
 * módulos).
 *
 *   1) POLL (gratis): consulta las guías ya registradas y persiste su estatus.
 *   2) LIBERA: borra de 17TRACK (deletetrack) las que llegaron a terminal.
 *   3) REGISTRA: da de alta guías DHL nuevas no-terminales, sin pasar del tope.
 */
export async function runDhlRecyclingCycle(
  shipmentService: ShipmentsService,
  seventeen: SeventeenTrackDhlService,
  quotaCap: number,
  logger: Logger,
): Promise<DhlCycleSummary> {
  const start = Date.now();
  const summary: DhlCycleSummary = {
    polledActive: 0,
    updated: 0,
    released: 0,
    registered: 0,
    quotaCap,
    quotaUsedAfter: 0,
    durationMin: 0,
  };

  // 1) POLL de las guías ya registradas (no gasta quota; skipRegister).
  const active = await shipmentService.getActiveRegisteredDhl();
  summary.polledActive = active.length;
  if (active.length > 0) {
    const numbers = active.map((a) => a.trackingNumber);
    const results = await seventeen.fetchTrackingStatuses(numbers, { skipRegister: true });
    const persisted = await shipmentService.persistDhlTrackingResults(results);
    summary.updated = persisted.updated.length;
    logger.log(`📦 [DHL] Poll: ${active.length} activas → actualizadas ${summary.updated}.`);
  } else {
    logger.log('📭 [DHL] No hay guías activas registradas para consultar.');
  }

  // 2) LIBERA quota de las que ya llegaron a terminal.
  const terminal = await shipmentService.getActiveRegisteredDhlTerminal();
  if (terminal.length > 0) {
    await seventeen.deleteNumbers(terminal.map((t) => t.trackingNumber));
    await shipmentService.markDhlReleased(terminal.map((t) => t.id));
    summary.released = terminal.length;
    logger.log(`♻️ [DHL] Liberados ${terminal.length} slot(s) de quota (terminales).`);
  }

  // 3) REGISTRA guías nuevas hasta el tope de quota.
  const activeCount = await shipmentService.countActiveRegisteredDhl();
  const available = quotaCap - activeCount;
  if (available > 0) {
    const candidates = await shipmentService.getUnregisteredDhl(available);
    if (candidates.length > 0) {
      const { registered } = await seventeen.registerNumbers(candidates.map((c) => c.trackingNumber));
      await shipmentService.markDhlRegistered(registered);
      summary.registered = registered.length;
      logger.log(`🆕 [DHL] Registradas ${registered.length}/${candidates.length} (quota libre: ${available}).`);
    } else {
      logger.log('✅ [DHL] No hay guías nuevas por registrar.');
    }
  } else {
    logger.warn(`⚠️ [DHL] Quota llena (${activeCount}/${quotaCap}); no se registran nuevas este ciclo.`);
  }

  summary.quotaUsedAfter = await shipmentService.countActiveRegisteredDhl();
  summary.durationMin = Number(((Date.now() - start) / 1000 / 60).toFixed(2));
  logger.log(`🏁 [DHL/17TRACK] Ciclo finalizado en ${summary.durationMin} min. Quota usada ≈ ${summary.quotaUsedAfter}/${quotaCap}.`);
  return summary;
}
