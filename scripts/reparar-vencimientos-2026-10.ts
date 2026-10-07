/**
 * Reparación de vencimientos (commitDateTime) mal leídos al subir consolidados (2026-10-06).
 *
 * El lector viejo solo entendía la fecha como texto `M/D/AAAA` y la hora como fracción de
 * Excel; con fecha real de Excel, `AAAA-MM-DD` u hora en texto descartaba la fecha del
 * archivo y ponía la de FedEx en línea o "ahora" (vencida desde la subida). Este script
 * vuelve a leer el ARCHIVO ORIGINAL (Bodega → Importaciones) con el lector nuevo
 * (`src/utils/commit-date.util.ts`) y corrige las guías cuyo día de vencimiento no coincide.
 *
 * POR DEFECTO NO ESCRIBE NADA: muestra qué cambiaría y deja un Excel con el detalle.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-vencimientos-2026-10.ts
 *   npx ts-node -r tsconfig-paths/register scripts/reparar-vencimientos-2026-10.ts --apply --user <userId>
 *
 * Opciones:
 *   --cons 305822137864,305821676711   consolidados a revisar (por defecto Cabos y Loreto)
 *   --archivo 305821676711=C:\ruta.xlsx  usa este archivo en vez del guardado en el servidor
 *   --ensayo   (con --apply) aplica, verifica y REVIERTE; no deja cambios
 *   --out <archivo.xlsx>
 *
 * NO se tocan: guías reprogramadas (cambio de fecha solicitado / DEX17, su fecha nueva es la
 * buena), guías sin fecha en el archivo, guías que no vienen en el archivo y las que ya
 * coinciden en el día (en hora de Hermosillo).
 * Bitácora: consolidated_change_log (action reparar_vencimientos) y audit_log.
 */
import 'dotenv/config';
import * as XLSX from 'xlsx';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { AppDataSource as ds } from '../src/data-source';
import { getPriority, parseDynamicFileF2, parseDynamicSheet, pickSheetWithHeaders } from '../src/utils/file-upload.utils';
import { commitInstantHermosillo } from '../src/utils/commit-date.util';

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? 'true' : def;
};
const CONS = (arg('cons', '305822137864,305821676711') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const OVERRIDES = new Map<string, string>(
  process.argv.flatMap((a, i) => (process.argv[i - 1] === '--archivo' ? [a] : []))
    .map((s) => { const k = s.indexOf('='); return [s.slice(0, k).trim(), s.slice(k + 1).trim()] as [string, string]; }),
);
const APPLY = process.argv.includes('--apply');
const ENSAYO = process.argv.includes('--ensayo');
const USER_ID = arg('user') ?? null;
const OUT = arg('out', `reparar-vencimientos-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.xlsx`)!;
const ACTION = 'reparar_vencimientos';
const WHO = 'Reparación vencimientos 2026-10';
class Rollback extends Error {}

type Row = Record<string, any>;
type FileCommit = { commitDate: string | null; commitTime: string; commitIssue?: string | null };

/** Lee el archivo original del consolidado (o el indicado con --archivo) con el lector nuevo. */
async function readFileCommits(consNumber: string, kind: 'master' | 'f2', refDate: string | null): Promise<{ source: string; byTn: Map<string, FileCommit> } | null> {
  let buffer: Buffer | null = null;
  let source = '';
  const override = kind === 'master' ? OVERRIDES.get(consNumber) : undefined;
  if (override) {
    buffer = await fs.readFile(override);
    source = override;
  } else {
    const files: Row[] = await ds.query(
      `SELECT originalName, storagePath FROM import_file WHERE consNumber = ? AND kind = ? ORDER BY createdAt DESC`,
      [consNumber, kind],
    );
    for (const f of files) {
      try { buffer = await fs.readFile(join(process.cwd(), f.storagePath)); source = `${f.originalName} (${f.storagePath})`; break; } catch { /* sigue */ }
    }
    if (!buffer) return null;
  }
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows: any[] = kind === 'master'
    ? parseDynamicSheet(wb, { fileName: source, refDate })
    : parseDynamicFileF2(pickSheetWithHeaders(wb, true).sheet, refDate);
  const byTn = new Map<string, FileCommit>();
  for (const r of rows) {
    const tn = String(r.trackingNumber ?? '').trim();
    if (tn && !byTn.has(tn)) byTn.set(tn, { commitDate: r.commitDate, commitTime: r.commitTime, commitIssue: r.commitIssue });
  }
  return { source, byTn };
}

async function detect(): Promise<{ cambiar: Row[]; sinCambio: Row[]; resumen: Row[] }> {
  const cambiar: Row[] = [];
  const sinCambio: Row[] = [];
  const resumen: Row[] = [];

  for (const consNumber of CONS) {
    const cons: Row[] = await ds.query(
      `SELECT c.id, DATE_FORMAT(c.date, '%Y-%m-%d') consDate, sb.name sucursal
         FROM consolidated c JOIN subsidiary sb ON sb.id = c.subsidiaryId
        WHERE TRIM(c.consNumber) = ? AND c.active = 1`,
      [consNumber],
    );
    if (!cons.length) { resumen.push({ consolidado: consNumber, nota: 'No hay consolidado activo con ese número' }); continue; }
    const refDate = cons[0].consDate ?? null;

    for (const [kind, table] of [['master', 'shipment'], ['f2', 'charge_shipment']] as const) {
      const ids = cons.map((c) => c.id);
      const guias: Row[] = await ds.query(
        `SELECT t.id, t.trackingNumber, t.status, t.commitDateTime, t.priority, sb.name sucursal,
                DATE_FORMAT(DATE_SUB(t.commitDateTime, INTERVAL 7 HOUR), '%Y-%m-%d') diaSistema,
                ${table === 'shipment'
                  ? `EXISTS (SELECT 1 FROM shipment_status ss WHERE ss.shipmentId = t.id AND (ss.status = 'cambio_fecha_solicitado' OR ss.exceptionCode = '17'))`
                  : '0'} reprogramadaHist
           FROM ${table} t JOIN subsidiary sb ON sb.id = t.subsidiaryId
          WHERE t.consolidatedId IN (?) AND t.active = 1`,
        [ids],
      );
      if (!guias.length) continue;

      const file = await readFileCommits(consNumber, kind, refDate);
      const tipo = kind === 'master' ? 'paquete' : 'carga F2';
      if (!file) {
        resumen.push({ consolidado: consNumber, tipo, guias: guias.length, nota: 'Sin archivo original disponible (usa --archivo cons=ruta)' });
        continue;
      }

      let n = 0;
      for (const g of guias) {
        const f = file.byTn.get(String(g.trackingNumber).trim());
        const base = {
          consolidado: consNumber, sucursal: g.sucursal, tipo, guia: g.trackingNumber, estatus: g.status,
          vencimientoSistema: g.diaSistema, vencimientoArchivo: f?.commitDate ?? null, horaArchivo: f?.commitTime ?? null,
        };
        const reprogramada = g.status === 'cambio_fecha_solicitado' || Number(g.reprogramadaHist) === 1;
        let motivo: string | null = null;
        if (!f) motivo = 'No viene en el archivo';
        else if (!f.commitDate) motivo = 'El archivo no trae fecha';
        else if (f.commitDate === g.diaSistema) motivo = 'Ya coincide';
        else if (reprogramada) motivo = 'Reprogramada (cambio de fecha solicitado): se respeta la fecha nueva';
        if (motivo) { sinCambio.push({ ...base, motivo }); continue; }

        const nuevo = commitInstantHermosillo(f!.commitDate!, f!.commitTime)!;
        cambiar.push({
          ...base, table, id: g.id,
          commitAnterior: new Date(g.commitDateTime).toISOString(), commitNuevo: nuevo.toISOString(),
          prioridadAnterior: g.priority, prioridadNueva: getPriority(nuevo),
        });
        n++;
      }
      resumen.push({ consolidado: consNumber, sucursal: cons[0].sucursal, tipo, guias: guias.length, aCorregir: n, archivo: file.source });
    }
  }
  return { cambiar, sinCambio, resumen };
}

async function main() {
  if (APPLY && !USER_ID && !ENSAYO) throw new Error('Para aplicar indica --user <id del usuario que autoriza>.');
  await ds.initialize();
  const [{ db }] = await ds.query('SELECT DATABASE() db');
  console.log(`\nBase de datos: ${db} @ ${(ds.options as any).host}   ·   modo: ${APPLY ? (ENSAYO ? 'ENSAYO (revierte)' : 'APLICAR') : 'SOLO MOSTRAR'}\n`);

  const { cambiar, sinCambio, resumen } = await detect();
  for (const r of resumen) {
    console.log(`${String(r.consolidado).padEnd(14)} ${String(r.sucursal ?? '').padEnd(16)} ${String(r.tipo ?? '').padEnd(9)} guías=${r.guias ?? 0}  a corregir=${r.aCorregir ?? 0}  ${r.nota ?? ''}`);
  }
  const motivos = sinCambio.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.motivo]: (acc[r.motivo] ?? 0) + 1 }), {});
  console.log('\nSin cambio:'); for (const [k, v] of Object.entries(motivos)) console.log(`  ${String(v).padStart(4)}  ${k}`);
  if (cambiar.length) {
    console.log('\nA corregir:');
    for (const r of cambiar) console.log(`  ${r.consolidado}  ${r.guia}  ${r.vencimientoSistema} → ${r.vencimientoArchivo}  (${r.estatus})`);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen.length ? resumen : [{ sinRegistros: true }]), 'Resumen');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cambiar.length ? cambiar : [{ sinRegistros: true }]), 'A corregir');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sinCambio.length ? sinCambio : [{ sinRegistros: true }]), 'Sin cambio');
  XLSX.writeFile(wb, OUT);
  console.log(`\nDetalle en: ${OUT}`);

  if (APPLY && cambiar.length) {
    try {
      await ds.transaction(async (m) => {
        for (const r of cambiar) {
          await m.query(`UPDATE ${r.table} SET commitDateTime = ?, priority = ? WHERE id = ?`, [new Date(r.commitNuevo), r.prioridadNueva, r.id]);
          await m.query(
            `INSERT INTO consolidated_change_log (id, approvalRequestId, action, consNumber, entityType, entityId, trackingNumber, field, oldValue, newValue, userId, userName, createdAt)
             VALUES (?, NULL, ?, ?, ?, ?, ?, 'commitDateTime', ?, ?, ?, ?, NOW())`,
            [randomUUID(), ACTION, r.consolidado, r.table, r.id, r.guia, r.commitAnterior, r.commitNuevo, USER_ID, WHO],
          );
        }
        await m.query(
          `INSERT INTO audit_log (id, userId, userName, module, action, result, severity, entityName, description, metadata, createdAt)
           VALUES (?, ?, ?, 'consolidados', 'update', 'success', 'warning', 'Vencimientos', ?, ?, NOW())`,
          [randomUUID(), USER_ID, WHO, `Vencimientos corregidos desde el archivo original: ${cambiar.length} guías`.slice(0, 500),
            JSON.stringify({ consolidados: CONS, guias: cambiar.length })],
        );
        if (ENSAYO) {
          const ok = (await Promise.all(cambiar.map(async (r) => {
            const [row] = await m.query(`SELECT DATE_FORMAT(DATE_SUB(commitDateTime, INTERVAL 7 HOUR), '%Y-%m-%d') d FROM ${r.table} WHERE id = ?`, [r.id]);
            return row?.d === r.vencimientoArchivo;
          }))).filter(Boolean).length;
          console.log(`\nEnsayo: ${ok}/${cambiar.length} guías quedaron con el vencimiento del archivo.`);
          throw new Rollback();
        }
      });
      console.log(`\nAplicado: ${cambiar.length} guías corregidas.`);
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
      console.log('Ensayo revertido, sin cambios.');
    }
  } else if (APPLY) {
    console.log('\nNada que aplicar.');
  }
  await ds.destroy();
}

main().catch(async (e) => {
  console.error('ERROR:', e?.message ?? e);
  try { await ds.destroy(); } catch { /* */ }
  process.exit(1);
});
