import * as XLSX from 'xlsx';
import { combineDhlWorkbook } from '../utils/dhl-excel.util';

/**
 * Texto del correo DHL listo para "Importar DHL": el cuerpo desde el primer bloque
 * "AWB :" (la impresión del sistema DHL con remitente, destinatario y eventos/JD).
 * Se quita lo de arriba (reenvío, firma) y se respetan los espacios: el lector DHL
 * separa remitente y destinatario por ellos. Sin bloques AWB → null.
 */
export function dhlPasteText(textBody: string | null | undefined): string | null {
  const text = String(textBody ?? '').replace(/\r\n/g, '\n');
  const m = text.match(/^[ \t]*AWB\s*:/m);
  if (!m || m.index === undefined) return null;
  return text.slice(m.index).replace(/^[ \t]+/, '').trimEnd();
}

/**
 * Vencimientos del Excel DHL de 3 hojas (Shipment/Piece/Event): { guía → fecha, JD → fecha }
 * (yyyy-MM-dd). La hoja simple que también mandan (guía, dirección, CP, CEN, FD) no trae
 * vencimiento → {} y se captura en la tabla.
 */
export function dhlDueDatesFromWorkbook(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    if (!wb.SheetNames.some((n) => /shipment|piece/i.test(n))) return out;
    for (const r of combineDhlWorkbook(wb)) {
      if (!r.commitDate) continue;
      if (r.trackingNumber && !out[r.trackingNumber]) out[r.trackingNumber] = r.commitDate;
      if (r.dhlUniqueId) out[r.dhlUniqueId] = r.commitDate;
    }
  } catch {
    return {};
  }
  return out;
}
