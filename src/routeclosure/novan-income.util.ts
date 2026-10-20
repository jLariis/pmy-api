import { canonicalFedexExceptionCode } from 'src/common/fedex-exception-code.util';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { hasWeekWithThreeDex08Days } from 'src/common/dex08-week.util';

/** Estatus FedEx autoritativo de una guía "No VAN", para decidir su ingreso en el cierre. */
export interface NoVanFedexOutcome {
  trackingNumber: string;
  delivered: boolean;
  dexCode: string | null;
  resolved: boolean; // false si FedEx no devolvió datos / hubo error
  /** Instantes de TODOS los 08 conocidos de la guía; solo se usan si `dexCode === '08'`. */
  dex08Dates?: Date[];
}

/** Campos de ingreso derivados de un outcome cobrable. */
export interface NoVanIncomeFields {
  incomeType: IncomeStatus;
  nonDeliveryStatus: string | null;
}

/**
 * Decide si un paquete "No VAN" (en ruta NO 31.5) genera ingreso y con qué estatus.
 *
 * Regla — espejo del flujo DHL: el ingreso se crea SIEMPRE con costo completo + código;
 * qué CUENTA lo decide `charge_rule` en lectura. Aquí solo decidimos si hay código que
 * aplicar:
 *  - Sin validación FedEx (`resolved=false`, no encontrado/caído) ⇒ no cobra (`null`).
 *  - En tránsito / sin entregar ni DEX (`!delivered && !dexCode`) ⇒ sin código ⇒ no cobra.
 *  - Entregado ⇒ `ENTREGADO`, sin `nonDeliveryStatus`.
 *  - No entregado con DEX ⇒ `NO_ENTREGADO`, `nonDeliveryStatus = dexCode`.
 *  - DEX 08 solo cobra con 3 DÍAS distintos con 08 en la MISMA semana ISO (misma regla
 *    que el cron y el motor nuevo; ver dex08-week.util). Si no, no se genera ingreso.
 *
 * Devuelve `null` cuando NO se debe generar ingreso.
 */
export function noVanIncomeDecision(input: NoVanFedexOutcome): NoVanIncomeFields | null {
  // '08D' es el mismo DEX08: sin normalizar se saltaba la regla de 3 visitas (Hermosillo 17-oct-2026).
  const outcome = { ...input, dexCode: canonicalFedexExceptionCode(input.dexCode) };
  if (!outcome.resolved) return null;
  if (!outcome.delivered && !outcome.dexCode) return null;
  if (!outcome.delivered && outcome.dexCode === '08' && !hasWeekWithThreeDex08Days(outcome.dex08Dates ?? [])) {
    return null;
  }

  return {
    incomeType: outcome.delivered ? IncomeStatus.ENTREGADO : IncomeStatus.NO_ENTREGADO,
    nonDeliveryStatus: outcome.delivered ? null : outcome.dexCode,
  };
}

/**
 * Outcome FedEx de un No VAN a partir del rastreo ganador (`trackResults[i]`): entregado (DL),
 * excepción con su código (DE) o "otro" (resuelto sin código). `null` ⇒ no resuelto.
 * Lo usan el cierre de ruta y la auditoría de No VAN del Consolidador.
 */
export function noVanOutcomeFromTrack(trackingNumber: string, winner: any | null): NoVanFedexOutcome {
  if (!winner) return { trackingNumber, delivered: false, dexCode: null, resolved: false };
  const headerCode = winner.latestStatusDetail?.code; // p.ej. 'DL' (entregado), 'DE' (excepción)
  const scans: any[] = winner.scanEvents || [];
  const latestScan = [...scans].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

  if (headerCode === 'DL' || latestScan?.eventType === 'DL') {
    return { trackingNumber, delivered: true, dexCode: null, resolved: true };
  }
  if (headerCode === 'DE' || latestScan?.eventType === 'DE') {
    const specificCode = latestScan?.exceptionCode || winner.latestStatusDetail?.ancillaryDetails?.[0]?.reason || null;
    // Todos los 08 que reporta FedEx (para la regla de 3 visitas en la misma semana).
    const dex08Dates = scans
      .filter((s) => s.eventType === 'DE' && s.exceptionCode === '08' && s.date)
      .map((s) => new Date(s.date));
    return { trackingNumber, delivered: false, dexCode: specificCode, resolved: true, dex08Dates };
  }
  return { trackingNumber, delivered: false, dexCode: null, resolved: true };
}
