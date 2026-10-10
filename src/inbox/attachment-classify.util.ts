import * as XLSX from 'xlsx';
import { headerAliases } from '../utils/header-detector.util';
import { isThreeSheetDhlWorkbook } from '../utils/dhl-excel.util';
import { normalize } from './text-normalize.util';
import { AttachmentKind, SheetSummary } from './inbox.types';
import { numbersInFilename } from './extract.util';
import { tsvMetaConsNumber } from './paste-plan.util';

/**
 * Clasificación de adjuntos de correos FedEx: tipo por nombre (aéreo, valor, F2,
 * CCP, master) y resumen por contenido (filas, CP y ciudades de destinatarios).
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 20_000;
const SPREADSHEET_EXT = /\.(xlsx|xlsm|xls|ods|csv)$/i;

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Texto de una celda SIN perder dígitos. Con formato "General", Excel (y `sheet_to_json`
 * con raw:false) muestra todo número de más de 11 dígitos en notación científica: las
 * guías FedEx (12) salían como 3.83961E+11 y ya no se podían subir ni cruzar con el
 * sistema. Aquí se toma el VALOR para enteros; fechas/horas de Excel → AAAA-MM-DD / HH:MM:SS.
 * Espejo de app-pmy lib/excel-to-rows.ts (mantener en sync). Requiere leer con cellNF:true.
 */
function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'n' && typeof cell.v === 'number') {
    const v = cell.v;
    if (cell.z && XLSX.SSF.is_date(String(cell.z))) {
      const d = XLSX.SSF.parse_date_code(v);
      const time = `${pad2(d.H)}:${pad2(d.M)}:${pad2(Math.round(d.S))}`;
      if (v < 1) return time;
      const date = `${d.y}-${pad2(d.m)}-${pad2(d.d)}`;
      return v % 1 ? `${date} ${time}` : date;
    }
    if (Number.isInteger(v)) return Number.isSafeInteger(v) ? String(v) : BigInt(v).toString();
    return String(v);
  }
  return String(cell.w ?? cell.v);
}

/** Renglones de la hoja como texto (sin renglones vacíos), con cada celda por `cellText`. */
function sheetTextRows(ws: XLSX.WorkSheet | undefined): string[][] {
  if (!ws || !ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) row.push(cellText(ws[XLSX.utils.encode_cell({ r, c })]));
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  return rows;
}

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

export type SheetRole = 'master' | 'f2' | 'cod' | 'hv' | 'aereo';

/** Para qué sirve una hoja según su nombre ("F2", "COD ", "HV ", "AEREO"); null = la principal. */
export function classifySheetName(name: string): SheetRole | null {
  const n = ` ${normalize(name)} `;
  if (/ (F2|F 2|31 5|CARGA F2) /.test(n)) return 'f2';
  if (/ (COD|COBROS?) /.test(n)) return 'cod';
  if (/ (HV|VALOR|ALTO VALOR|HIGH VALUE) /.test(n)) return 'hv';
  if (/ AEREO /.test(n)) return 'aereo';
  return null;
}

export interface SheetTsv {
  name: string;
  role: SheetRole | null;
  tsv: string;
  rows: number;
}

/**
 * Todas las hojas con encabezado de guías, cada una como TSV (lo que se copiaría de
 * Excel). FedEx a veces manda un solo libro con hojas YAQUI / F2 / COD / HV.
 */
export function workbookSheets(buf: Buffer): SheetTsv[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, cellDates: false, cellNF: true, sheetRows: MAX_ROWS + 20 });
  } catch {
    return [];
  }
  const trimEnd = (r: string[]) => {
    let n = r.length;
    while (n > 0 && r[n - 1] === '') n--;
    return r.slice(0, n);
  };
  const out: SheetTsv[] = [];
  for (const name of wb.SheetNames) {
    const rows = sheetTextRows(wb.Sheets[name]).map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ').trim()));
    const headerIdx = rows.slice(0, 15).findIndex((r) => r.some((c) => headerAliases[headerKey(c)] === 'trackingNumber'));
    if (headerIdx < 0) continue;
    const data = rows.length - headerIdx - 1;
    if (data <= 0) continue;
    out.push({ name: name.trim(), role: classifySheetName(name), tsv: rows.map((r) => trimEnd(r).join('\t')).join('\n'), rows: data });
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
    wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, cellDates: false, cellNF: true, sheetRows: MAX_ROWS + 20 });
  } catch {
    return null;
  }
  let best: { rows: string[][]; score: number } | null = null;
  for (const name of wb.SheetNames) {
    const rows = sheetTextRows(wb.Sheets[name]).map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ').trim()));
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

const CONS_KINDS: AttachmentKind[] = ['master', 'master_aereo', 'f2', 'high_value', 'dhl'];

/**
 * Número de consolidado de un adjunto: el del nombre del archivo o, si no trae, el de
 * la fila "meta" que FedEx pone arriba del encabezado ("305821338193 … SALIDA AEREA").
 */
export function attachmentConsNumber(filename: string, kind: AttachmentKind, content: Buffer | null): string | null {
  const fromName = numbersInFilename(filename)[0];
  if (fromName) return fromName;
  if (!content || !CONS_KINDS.includes(kind) || !isSpreadsheet(filename)) return null;
  return tsvMetaConsNumber(workbookToTsv(content));
}

export interface SheetPreview {
  name: string;
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

/** Vista previa de un libro para el visor de la app: todas las hojas, recortadas. */
export function previewWorkbook(buf: Buffer, maxRows = 500, maxCols = 40): SheetPreview[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, cellNF: true, sheetRows: maxRows + 1 });
  } catch {
    return [];
  }
  // sheetRows corta la lectura; el total real se toma del rango de la hoja.
  let full: XLSX.WorkBook | null = null;
  try {
    full = XLSX.read(buf, { type: 'buffer', bookSheets: false, cellFormula: false, cellHTML: false, sheetStubs: false, dense: true });
  } catch {
    full = null;
  }
  return wb.SheetNames.map((name) => {
    const rows = sheetTextRows(wb.Sheets[name]).map((r) => r.slice(0, maxCols).map((c) => c.trim()));
    const ref = full?.Sheets[name]?.['!ref'];
    const totalRows = ref ? XLSX.utils.decode_range(ref).e.r + 1 : rows.length;
    return { name: name.trim(), rows: rows.slice(0, maxRows), totalRows, truncated: totalRows > maxRows };
  });
}
