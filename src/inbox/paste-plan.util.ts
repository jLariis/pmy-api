import { AttachmentKind, Cobro } from './inbox.types';

/**
 * Plan de "Pegar FedEx" para un correo: qué lotes mandar al pegado (master, aéreo,
 * F2), con qué consolidado/fecha/sucursal, y qué cobros y guías de valor llevan.
 * Función pura; el servicio le pasa los datos ya cargados.
 */

export type PasteBatchKind = 'master' | 'aereo' | 'f2';

export interface PasteBatch {
  key: string; // estable por correo: tipo + id de adjunto
  kind: PasteBatchKind;
  attachmentId: string;
  filename: string;
  subsidiaryId: string | null;
  consNumber: string; // '' = lo captura el usuario en el pegado
  consDate: string; // YYYY-MM-DD (hora de Hermosillo)
  isAereo: boolean;
  raw: string; // TSV de la hoja, como si se copiara de Excel
  paymentsRaw: string; // cobros del cuerpo del correo en TSV
  hvRaw: string; // guías de valor (TSV de la hoja "valor")
  rows: number;
  blockedReason: string | null;
  done: boolean; // ya se mandó desde el correo
  duplicateOf?: string; // key del lote con las mismas guías
}

export interface PlanAttachment {
  id: string;
  filename: string;
  kind: AttachmentKind;
  consNumber: string | null;
  tsv: string | null;
}

export interface PlanInput {
  subsidiaryId: string | null;
  receivedAt: Date;
  attachments: PlanAttachment[];
  announced: { consNumber: string; kind: string }[];
  cobros: Cobro[];
  /** Master ya conocido de esa sucursal ese día (subido o anunciado por otro correo). */
  dayMasterConsNumber: string | null;
  /** Lotes ya mandados al pegado desde este correo (key). */
  doneKeys: string[];
}

const TZ_OFFSET_MS = 7 * 3_600_000; // Hermosillo, UTC−7 fijo
export const hmoDay = (d: Date): string => new Date(d.getTime() - TZ_OFFSET_MS).toISOString().slice(0, 10);

export function cobrosToTsv(cobros: Cobro[]): string {
  if (!cobros.length) return '';
  const lines = ['Tracking Number\tLast COMM Scan Date\tLast COMM Scan Update'];
  for (const c of cobros) {
    const concept = c.amount != null ? `${c.concept} ${c.amount} MXP` : c.concept;
    lines.push(`${c.trackingNumber}\t${c.date ?? ''}\t${concept}`);
  }
  return lines.join('\n');
}

const rowCount = (tsv: string | null) => (tsv ? Math.max(0, tsv.split('\n').length - 1) : 0);

const TRACKING_HEADER = /^(tracking\s*(number|no\.?)?|gu[ií]a)$/i;

/** Guías (columna de tracking) y número de columnas del encabezado de un TSV. */
export function tsvTrackings(tsv: string | null): { trackings: Set<string>; columns: number } {
  const out = new Set<string>();
  if (!tsv) return { trackings: out, columns: 0 };
  const rows = tsv.split('\n').map((l) => l.split('\t'));
  const h = rows.slice(0, 15).findIndex((r) => r.some((c) => TRACKING_HEADER.test(c.trim())));
  if (h < 0) return { trackings: out, columns: 0 };
  const col = rows[h].findIndex((c) => TRACKING_HEADER.test(c.trim()));
  for (const r of rows.slice(h + 1)) {
    const t = (r[col] ?? '').trim();
    if (t) out.add(t);
  }
  return { trackings: out, columns: rows[h].filter((c) => c.trim()).length };
}

/** ¿Dos archivos traen prácticamente las mismas guías? (≥ 90 % del menor) */
function sameShipments(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let common = 0;
  small.forEach((t) => {
    if (big.has(t)) common++;
  });
  return common / small.size >= 0.9;
}

export function buildPastePlan(i: PlanInput): PasteBatch[] {
  const consDate = hmoDay(i.receivedAt);
  const paymentsRaw = cobrosToTsv(i.cobros);
  const hvRaw = i.attachments
    .filter((a) => a.kind === 'high_value' && a.tsv)
    .map((a) => a.tsv as string)
    .join('\n');
  const announcedMaster = i.announced.find((a) => a.kind === 'master')?.consNumber ?? null;
  const announcedF2 = i.announced.find((a) => a.kind === 'f2')?.consNumber ?? null;
  const masterFiles = i.attachments.filter((a) => a.kind === 'master');
  const out: PasteBatch[] = [];

  for (const a of i.attachments) {
    let kind: PasteBatchKind | null = null;
    if (a.kind === 'master') kind = 'master';
    else if (a.kind === 'master_aereo') kind = 'aereo';
    else if (a.kind === 'f2') kind = 'f2';
    if (!kind) continue;

    let consNumber = '';
    let blockedReason: string | null = null;
    if (kind === 'master') {
      // Un solo master en el correo → toma el número anunciado; si hay varios, el del archivo.
      consNumber = a.consNumber ?? (masterFiles.length === 1 ? announcedMaster ?? '' : '');
    } else if (kind === 'f2') {
      consNumber = announcedF2 ?? a.consNumber ?? announcedMaster ?? '';
    } else {
      // Aéreo: va al master de esa sucursal ese día.
      consNumber = announcedMaster ?? i.dayMasterConsNumber ?? '';
      if (!consNumber) blockedReason = 'Esperando el master del día de esta sucursal';
    }
    if (!a.tsv) blockedReason = 'No se pudieron leer las guías de este archivo';
    if (!i.subsidiaryId) blockedReason = blockedReason ?? 'Falta confirmar la sucursal';

    const key = `${kind}:${a.id}`;
    out.push({
      key,
      kind,
      attachmentId: a.id,
      filename: a.filename,
      subsidiaryId: i.subsidiaryId,
      consNumber,
      consDate,
      isAereo: kind === 'aereo',
      raw: a.tsv ?? '',
      paymentsRaw,
      hvRaw: kind === 'f2' ? '' : hvRaw,
      rows: rowCount(a.tsv),
      blockedReason,
      done: i.doneKeys.includes(key),
    });
  }
  // Archivos repetidos (p. ej. "367.xlsx" y "PREALERTA … RUTA 367.xlsx"): se deja el más completo.
  const info = new Map(out.map((b) => [b.key, tsvTrackings(b.raw)]));
  const ranked = [...out].sort((x, y) => (info.get(y.key)!.columns - info.get(x.key)!.columns) || y.rows - x.rows);
  const kept: PasteBatch[] = [];
  for (const b of ranked) {
    const twin = kept.find((k) => k.kind === b.kind && sameShipments(info.get(k.key)!.trackings, info.get(b.key)!.trackings));
    if (twin) {
      b.blockedReason = `Mismas guías que "${twin.filename}" (no se sube dos veces)`;
      b.duplicateOf = twin.key;
    } else kept.push(b);
  }
  // Orden del día: master → aéreo → F2; los repetidos al final.
  const order: Record<PasteBatchKind, number> = { master: 0, aereo: 1, f2: 2 };
  return out.sort((x, y) => Number(!!x.duplicateOf) - Number(!!y.duplicateOf) || order[x.kind] - order[y.kind]);
}
