import { toHermosilloDateString } from './utils';

/**
 * ¿La entrega (DL) la hicimos NOSOTROS? Regla de negocio (2026-09-24): si la guía está en
 * un consolidado nuestro y salió en una ruta nuestra el MISMO día (Hermosillo) en que FedEx
 * reporta la entrega, la entrega es nuestra — aunque FedEx la marque como "por terceros"
 * (código 005: el "trusted third-party vendor" somos nosotros) o haya un OD viejo en su
 * historial. En ese caso NUNCA debe quedar como ENTREGADO_POR_FEDEX (perdería el cobro).
 */
export function isOurRouteDelivery(input: { deliveredAt: Date | null; routeDays: string[]; hasConsolidado: boolean }): boolean {
  if (!input.deliveredAt || !input.hasConsolidado || !input.routeDays.length) return false;
  return input.routeDays.includes(toHermosilloDateString(input.deliveredAt));
}

/** Días de ruta (YYYY-MM-DD) de las salidas a ruta de una guía. `routeDate` es DATE (día-solo); sin él, el día Hermosillo de creación. */
export function routeDaysOf(dispatches: { routeDate?: string | Date | null; createdAt?: string | Date | null }[]): string[] {
  const days = new Set<string>();
  for (const d of dispatches) {
    if (d.routeDate) days.add(typeof d.routeDate === 'string' ? d.routeDate.slice(0, 10) : d.routeDate.toISOString().slice(0, 10));
    else if (d.createdAt) days.add(toHermosilloDateString(new Date(d.createdAt))); // rutas viejas sin routeDate
  }
  return [...days];
}
