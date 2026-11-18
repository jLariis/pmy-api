import { herDay } from 'src/common/ld-rule.util';
import { TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';

/**
 * Paquetes "críticos" de un inventario: los que VENCEN HOY (día en hora Hermosillo) y siguen
 * activos (no entregados, devueltos ni en otro desenlace final).
 *
 * Antes se filtraba `EN_RUTA` con el día en UTC: un paquete inventariado está en bodega, así que
 * la lista salía vacía y el correo se mandaba igual con "No se encontraron paquetes".
 */
export function pickCriticalPackages<T extends { commitDateTime?: Date | string | null; status?: string | null }>(
  packages: T[],
  now: Date = new Date(),
): T[] {
  const today = herDay(now);
  const terminal = new Set<string>(TERMINAL_SHIPMENT_STATUSES as string[]);
  return (packages ?? []).filter((p) => {
    if (!p?.commitDateTime) return false;
    if (terminal.has(String(p.status ?? '').toLowerCase())) return false;
    return herDay(p.commitDateTime) === today;
  });
}

/** Destinatarios en copia sin huecos ("null", vacíos) ni repetidos. */
export function buildCcList(...emails: (string | null | undefined)[]): string {
  const out: string[] = [];
  for (const raw of emails) {
    for (const e of String(raw ?? '').split(/[,;]/)) {
      const v = e.trim();
      if (v && v.toLowerCase() !== 'null' && v.toLowerCase() !== 'undefined' && !out.includes(v)) out.push(v);
    }
  }
  return out.join(', ');
}

/** Escapa texto para meterlo en el HTML del correo. */
export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
