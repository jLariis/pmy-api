import * as XLSX from 'xlsx';
import { DhlShipmentDto } from 'src/shipments/dto/dhl/dhl-shipment.dto';
import { normalizeTrackingValue, normalizePhoneValue } from './file-upload.utils';

/**
 * Combinador del export "nativo" de DHL, que reparte los datos en 3 hojas:
 *  - Shipment: una fila por GUÍA maestra (HWB No) con dirección, CP y el
 *    vencimiento REAL (EDD). NO trae nombre ni PID.
 *  - Piece:    una fila por PIEZA (Piece ID = JD…) con guía, nombre y valor.
 *    NO trae dirección/CP.
 *  - Event:    histórico de eventos (no se usa para armar el envío).
 *
 * El pegado de DHL es a nivel PIEZA, así que la BASE aquí es la hoja Piece
 * (una fila = un envío con su `dhlUniqueId`), y se enriquece por guía con la
 * hoja Shipment (dirección, CP y vencimiento). El vencimiento REAL sale de
 * Shipment; si una pieza no tiene su guía en Shipment se marca `incomplete` y,
 * como respaldo para no dejarla sin fecha, se usa el EDD de la propia pieza.
 */
export interface CombinedDhlRow {
  trackingNumber: string;
  dhlUniqueId: string;
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientZip: string;
  recipientPhone: string;
  /** yyyy-MM-dd: EDD de la hoja Shipment (real); respaldo = EDD de la pieza. */
  commitDate: string | null;
  declaredValue?: number;
  weight?: number;
  shipmentTime?: string;
  description?: string;
  /** true = la pieza no cruzó con la hoja Shipment (sin dirección/CP reales). */
  incomplete: boolean;
}

/** Normaliza un encabezado como lo hace header-detector: sin espacios ni símbolos. */
function norm(header: unknown): string {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\d\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '');
}

function str(v: unknown): string {
  const s = String(v ?? '').trim();
  return s;
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Convierte una celda de fecha (Date, serial de Excel o texto) a `yyyy-MM-dd`. */
export function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;

  const pad = (n: number) => String(n).padStart(2, '0');

  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }

  const s = String(v).trim();

  // Serial de Excel (p. ej. 46280) → fecha.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 90000) {
      const parsed: any = (XLSX as any).SSF?.parse_date_code?.(n);
      if (parsed && parsed.y) return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
    }
  }

  // ISO: yyyy-MM-dd
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`;

  // US: MM/DD/YYYY (formato del export DHL)
  const us = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (us) return `${us[3]}-${pad(+us[1])}-${pad(+us[2])}`;

  // Último recurso: que JS lo intente.
  const d = new Date(s);
  if (!isNaN(d.getTime())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return null;
}

interface SheetView {
  rows: any[][];
  idx: Record<string, number>;
  headerRowIndex: number;
}

function readSheet(sheet: XLSX.Sheet): SheetView {
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] || [];
    const idx: Record<string, number> = {};
    row.forEach((cell, j) => {
      const n = norm(cell);
      if (n && idx[n] === undefined) idx[n] = j;
    });
    if (idx['hwbno'] !== undefined) return { rows, idx, headerRowIndex: i };
  }
  return { rows, idx: {}, headerRowIndex: 0 };
}

function findSheet(
  workbook: XLSX.WorkBook,
  predicate: (idx: Record<string, number>) => boolean,
): SheetView | null {
  for (const name of workbook.SheetNames || []) {
    const view = readSheet(workbook.Sheets[name]);
    if (predicate(view.idx)) return view;
  }
  return null;
}

/**
 * ¿Es la hoja Piece? Tiene `Piece ID` PERO NO es la hoja Event: la hoja Event
 * también trae `HWB No` y `Piece ID` (una fila por evento), así que hay que
 * excluirla por sus columnas propias (`Event Cd` / `Event Dtm`). Si no, se
 * tomaría Event como base y saldrían cientos de filas de más.
 */
function isPieceIdx(idx: Record<string, number>): boolean {
  return (
    idx['pieceid'] !== undefined &&
    idx['eventcd'] === undefined &&
    idx['eventdtm'] === undefined
  );
}

/**
 * ¿El libro es el export multi-hoja de DHL? Se detecta por CONTENIDO (headers),
 * no por el nombre de la hoja: debe existir una hoja con `Piece ID` y otra con
 * dirección/CP del destinatario (`Rcvr Addr 1` / `Rcvr Postcode`).
 */
export function isThreeSheetDhlWorkbook(workbook: XLSX.WorkBook): boolean {
  const piece = findSheet(workbook, isPieceIdx);
  const shipment = findSheet(
    workbook,
    (idx) => idx['rcvraddr1'] !== undefined || idx['rcvrpostcode'] !== undefined,
  );
  return !!piece && !!shipment;
}

/** Combina las hojas Piece (base) + Shipment (dirección/CP/vencimiento real). */
export function combineDhlWorkbook(workbook: XLSX.WorkBook): CombinedDhlRow[] {
  const piece = findSheet(workbook, isPieceIdx);
  if (!piece) return [];

  const shipment = findSheet(
    workbook,
    (idx) => idx['rcvraddr1'] !== undefined || idx['rcvrpostcode'] !== undefined,
  );

  // Mapa por guía desde la hoja Shipment.
  const shipByGuide = new Map<string, { address: string; zip: string; edd: string | null }>();
  if (shipment) {
    const { rows, idx, headerRowIndex } = shipment;
    for (let r = headerRowIndex + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const guide = normalizeTrackingValue(row[idx['hwbno']]);
      if (!guide) continue;
      const a1 = str(row[idx['rcvraddr1']]);
      const a2 = str(row[idx['rcvraddr2']]);
      const address = [a1, a2].filter(Boolean).join(', ');
      const zip = str(row[idx['rcvrpostcode']]);
      const edd = toIsoDate(row[idx['edd']]);
      shipByGuide.set(guide, { address, zip, edd });
    }
  }

  const { rows, idx, headerRowIndex } = piece;
  const out: CombinedDhlRow[] = [];
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const guide = normalizeTrackingValue(row[idx['hwbno']]);
    const pid = str(row[idx['pieceid']]);
    if (!guide && !pid) continue;

    const ship = shipByGuide.get(guide);
    const pieceEdd = toIsoDate(row[idx['edd']]);

    out.push({
      trackingNumber: guide,
      dhlUniqueId: pid,
      recipientName: str(row[idx['receivername']]),
      recipientAddress: ship?.address || '',
      recipientCity: '',
      recipientZip: ship?.zip || '',
      recipientPhone: normalizePhoneValue(row[idx['phone']]),
      // El vencimiento REAL es el de Shipment; respaldo = EDD de la pieza.
      commitDate: (ship?.edd ?? pieceEdd) || null,
      declaredValue: num(row[idx['value']]),
      weight: num(row[idx['pieceweight']] ?? row[idx['shpweight']]),
      shipmentTime: toIsoDate(row[idx['clockstart']]) || '',
      description: str(row[idx['description']]),
      incomplete: !ship,
    });
  }

  // Orden por guía master (trackingNumber); las piezas de una misma remesa
  // quedan juntas y se desempata por PID. Numérico para que 8303… no quede
  // antes que 1110… por comparación de texto.
  out.sort((a, b) => {
    const t = a.trackingNumber.localeCompare(b.trackingNumber, undefined, { numeric: true, sensitivity: 'base' });
    return t !== 0 ? t : a.dhlUniqueId.localeCompare(b.dhlUniqueId, undefined, { numeric: true, sensitivity: 'base' });
  });

  return out;
}

/** Adapta las filas combinadas al shape del preview del pegado (`DhlShipmentDto`). */
export function combinedToDhlShipmentDto(rows: CombinedDhlRow[]): DhlShipmentDto[] {
  return rows.map((r) => ({
    awb: r.trackingNumber,
    pid: r.dhlUniqueId,
    origin: '',
    destination: '',
    shipmentTime: r.shipmentTime || '',
    product: '',
    pieces: 1,
    weight: r.weight || 0,
    declaredValue: r.declaredValue,
    description: r.description || '',
    shipperAccount: '',
    payerAccount: '',
    receiver: {
      name: r.recipientName || '',
      contactName: r.recipientName || '',
      address1: r.recipientAddress || '',
      address2: '',
      city: r.recipientCity || '',
      state: '',
      country: 'MX',
      zip: r.recipientZip || '',
      phone: r.recipientPhone || '',
    },
    dueDate: r.commitDate || undefined,
    incomplete: r.incomplete,
  }));
}
