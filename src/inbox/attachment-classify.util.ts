import * as XLSX from 'xlsx';
import { headerAliases } from '../utils/header-detector.util';
import { isThreeSheetDhlWorkbook } from '../utils/dhl-excel.util';
import { normalize } from './text-normalize.util';
import { AttachmentKind, SheetSummary } from './inbox.types';

/**
 * Clasificación de adjuntos de correos FedEx: tipo por nombre (aéreo, valor, F2,
 * CCP, master) y resumen por contenido (filas, CP y ciudades de destinatarios).
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 20_000;
const SPREADSHEET_EXT = /\.(xlsx|xlsm|xls|ods|csv)$/i;

export function isSpreadsheet(filename: string): boolean {
  return SPREADSHEET_EXT.test(filename ?? '');
}

export function classifyByName(filename: string): AttachmentKind | null {
  if (/\.pdf$/i.test(filename ?? '')) return 'pdf';
  if (!isSpreadsheet(filename)) return 'other';
  const n = ` ${normalize(filename.replace(SPREADSHEET_EXT, ''))} `;
  // CCP (carta porte) primero: "ccp aereo" / "ccp valor" son cartas porte, no guías.
  if (/ CCP /.test(n)) return 'ccp';
  if (/ AEREO /.test(n)) return 'master_aereo';
  if (/ VALOR /.test(n)) return 'high_value';
  if (/ F2 /.test(n) || / 31 5 /.test(n)) return 'f2';
  if (/ (CARGA|PREALERTA|YAQUI|SALIDA|MASTER) /.test(n)) return 'master';
  return null;
}

function headerKey(cell: unknown): string {
  if (typeof cell !== 'string') return '';
  return cell.trim().toLowerCase().replace(/[^\w\d\s]/g, ' ').replace(/\s+/g, '');
}

const DHL_ZIP_KEYS = ['rcvrpostcode', 'postcode', 'cp'];
const DHL_CITY_KEYS = ['rcvrcity', 'ciudad'];

export function summarizeWorkbook(buf: Buffer): SheetSummary {
  const empty: SheetSummary = { rowCount: 0, zips: {}, cities: {}, looksFedex: false, isDhl: false };
  if (buf.length > MAX_ATTACHMENT_BYTES) return { ...empty, parseError: 'Archivo demasiado grande para revisarlo' };
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, sheetRows: MAX_ROWS + 20 });
  } catch {
    return { ...empty, parseError: 'No se pudo abrir el archivo (puede venir dañado)' };
  }
  const isDhl = isThreeSheetDhlWorkbook(wb);
  const out: SheetSummary = { ...empty, isDhl };

  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false }) as unknown[][];
    let headerRow = -1;
    let map: Record<string, number> = {};
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const m: Record<string, number> = {};
      rows[i].forEach((c, idx) => {
        const k = headerKey(c);
        const canon = headerAliases[k];
        if (canon && m[canon] === undefined) m[canon] = idx;
        if (DHL_ZIP_KEYS.includes(k) && m.recipientZip === undefined) m.recipientZip = idx;
        if (DHL_CITY_KEYS.includes(k) && m.recipientCity === undefined) m.recipientCity = idx;
      });
      if (m.trackingNumber !== undefined || m.recipientZip !== undefined) {
        headerRow = i;
        map = m;
        break;
      }
    }
    if (headerRow < 0) continue;
    if (map.trackingNumber !== undefined && (map.recipientZip !== undefined || map.recipientCity !== undefined)) {
      out.looksFedex = out.looksFedex || !isDhl;
    }
    for (let r = headerRow + 1; r < rows.length && out.rowCount < MAX_ROWS; r++) {
      const row = rows[r];
      const tn = map.trackingNumber !== undefined ? String(row[map.trackingNumber] ?? '').trim() : '';
      const zipRaw = map.recipientZip !== undefined ? String(row[map.recipientZip] ?? '') : '';
      const zip = (zipRaw.match(/\d{4,5}/)?.[0] ?? '').padStart(5, '0');
      if (!tn && !zipRaw.trim()) continue;
      out.rowCount++;
      if (/^\d{5}$/.test(zip) && zip !== '00000') out.zips[zip] = (out.zips[zip] ?? 0) + 1;
      const city = map.recipientCity !== undefined ? normalize(String(row[map.recipientCity] ?? '')) : '';
      if (city) out.cities[city] = (out.cities[city] ?? 0) + 1;
    }
  }
  return out;
}

/**
 * Convierte el libro a texto TSV, tal como quedaría al copiar la hoja de Excel y
 * pegarla en "Pegar FedEx". Elige la hoja con más filas bajo un encabezado FedEx.
 */
export function workbookToTsv(buf: Buffer): string | null {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, cellDates: false, sheetRows: MAX_ROWS + 20 });
  } catch {
    return null;
  }
  let best: { rows: string[][]; score: number } | null = null;
  for (const name of wb.SheetNames) {
    const rows = (XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false, raw: false }) as unknown[][]).map((r) =>
      r.map((c) => String(c ?? '').replace(/[\t\r\n]+/g, ' ').trim()),
    );
    const headerIdx = rows.slice(0, 15).findIndex((r) => r.some((c) => headerAliases[headerKey(c)] === 'trackingNumber'));
    if (headerIdx < 0) continue;
    const score = rows.length - headerIdx - 1;
    if (!best || score > best.score) best = { rows, score };
  }
  if (!best || best.score <= 0) return null;
  const trimEnd = (r: string[]) => {
    let n = r.length;
    while (n > 0 && r[n - 1] === '') n--;
    return r.slice(0, n);
  };
  return best.rows.map((r) => trimEnd(r).join('\t')).join('\n');
}

export interface ClassifyItem {
  filename: string;
  byName: AttachmentKind | null;
  summary: SheetSummary | null;
}

/** Tipo final de cada adjunto; CCP se ignora si el correo trae master. */
export function finalizeKinds(items: ClassifyItem[]): AttachmentKind[] {
  const kinds: AttachmentKind[] = items.map((it) => {
    if (it.summary?.isDhl) return 'dhl';
    if (it.byName) return it.byName;
    if (it.summary?.looksFedex) return 'master';
    return 'other';
  });
  const hasMaster = kinds.some((k) => k === 'master' || k === 'master_aereo' || k === 'high_value' || k === 'f2');
  return kinds.map((k) => (k === 'ccp' && hasMaster ? 'ccp_ignored' : k));
}
