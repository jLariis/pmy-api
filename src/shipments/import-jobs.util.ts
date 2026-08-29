import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { CanonicalRow, ImportJobKind } from './import-jobs.types';

const CANONICAL_KEYS: (keyof CanonicalRow)[] = [
  'trackingNumber', 'recipientName', 'recipientAddress', 'recipientCity',
  'recipientZip', 'commitDate', 'commitTime', 'recipientPhone', 'cod', 'isHighValue',
];

/** Limpia guías que llegan como número de Excel; no toca ids alfanuméricos (DHL). */
export function normalizeTracking(v: unknown): string {
  let s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d+\.0+$/.test(s)) s = s.split('.')[0];
  if (/^\d(\.\d+)?[eE][+-]?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = n.toLocaleString('fullwide', { useGrouping: false });
  }
  const stripped = s.replace(/[\s-]/g, '');
  if (/^\d+$/.test(stripped)) s = stripped;
  return s;
}

/** Valida y normaliza filas canónicas del FE. NO re-mapea columnas. */
export function parsePastedRows(rows: unknown, _kind: ImportJobKind): { rows: CanonicalRow[]; totalRows: number } {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new BadRequestException('El pegado no contiene filas.');
  }
  const out: CanonicalRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const src = raw as Record<string, unknown>;
    const trackingNumber = normalizeTracking(src.trackingNumber);
    if (!trackingNumber) continue; // fila sin guía se omite (no aborta)
    const row: CanonicalRow = { trackingNumber };
    for (const k of CANONICAL_KEYS) {
      if (k === 'trackingNumber') continue;
      if (k === 'isHighValue') { if (src.isHighValue === true) row.isHighValue = true; continue; }
      const val = src[k];
      if (val !== undefined && val !== null) row[k] = String(val).trim() as never;
    }
    out.push(row);
  }
  if (out.length === 0) throw new BadRequestException('Ninguna fila del pegado tiene guía válida.');
  return { rows: out, totalRows: out.length };
}

/** Clasifica guías nuevas / duplicadas / reingresos. Espejo de addConsMasterBySubsidiary. */
export function classifyMasterRows(
  rows: CanonicalRow[],
  existing: Map<string, { consolidatedId: string | null; status: string }>,
  targetConsId: string,
  returnStatuses: string[],
): { toInsert: CanonicalRow[]; duplicated: CanonicalRow[]; recycledTrackings: string[]; toMarkReturned: string[] } {
  const toInsert: CanonicalRow[] = [];
  const duplicated: CanonicalRow[] = [];
  const recycledTrackings: string[] = [];
  const toMarkReturned: string[] = [];
  const returns = returnStatuses.map((s) => s.toLowerCase());
  const seen = new Set<string>();

  for (const row of rows) {
    const tn = row.trackingNumber;
    if (seen.has(tn)) { duplicated.push(row); continue; } // duplicada dentro del pegado
    seen.add(tn);
    const prev = existing.get(tn);
    if (!prev) { toInsert.push(row); continue; } // nueva
    if (prev.consolidatedId === targetConsId) { duplicated.push(row); continue; } // ya en este cons
    // reingreso desde otro cons
    toInsert.push(row);
    recycledTrackings.push(tn);
    if (!returns.includes((prev.status || '').toLowerCase())) toMarkReturned.push(tn);
  }
  return { toInsert, duplicated, recycledTrackings, toMarkReturned };
}

/** Hash estable del payload (claves ordenadas) para idempotencia. */
export function hashRows(rows: CanonicalRow[]): string {
  const sortedKeys = [...CANONICAL_KEYS].sort();
  const norm = rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const k of sortedKeys) if (r[k] !== undefined) o[k] = r[k];
    return o;
  });
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}
