import { RequestType } from 'src/entities/maintenance-request.entity';
import { ivaOn, MoneyItem } from './money.util';

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  mantenimiento: 'Mantenimiento',
  servicio: 'Servicio',
  reparacion: 'Reparación',
  compra: 'Compra',
};

export const AVAILABILITY_LABEL: Record<string, string> = { si: 'En existencia', no: 'Sin existencia', sobre_pedido: 'Sobre pedido' };

const pct = (r: number) => `${Number((r * 100).toFixed(2))}%`;

/** Texto corto de los impuestos de una partida: "IVA", "IVA + IEPS 8%", "Sin impuestos". */
export function taxLabel(i: MoneyItem): string {
  const parts: string[] = [];
  if (ivaOn(i)) parts.push('IVA');
  if (i.iepsEnabled) parts.push(`IEPS ${pct(Number(i.iepsRate ?? 0))}`);
  return parts.length ? parts.join(' + ') : 'Sin impuestos';
}

/** Existencia legible: "En existencia", "Sobre pedido (3 días)". */
export function availabilityLabel(availability?: string | null, leadTimeDays?: number | null): string {
  const base = AVAILABILITY_LABEL[availability ?? ''] ?? '';
  if (availability === 'sobre_pedido' && leadTimeDays) return `${base} (${leadTimeDays} día${leadTimeDays === 1 ? '' : 's'})`;
  return base;
}
