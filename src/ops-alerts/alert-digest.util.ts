/**
 * Mensajes de las alertas automáticas, con el mismo estilo que "Mandar aviso": un bloque por
 * consolidado (avance, hallazgos del análisis) y, por sucursal, quién lo sube normalmente.
 *  - buildAlertDigest: UN mensaje por revisión (cada 5 min) para los grupos generales.
 *  - buildAlertMessage: el de un solo consolidado (campana / números de la sucursal).
 */
import { hermosilloDateTimeText, hermosilloTimeText } from '../common/hermosillo-text.util';
import { Finding } from './consolidated-analysis.util';

export interface AlertBlock {
  level: number; // 1 vencido · 2 +30 min · 3 +60 min
  subsidiaryId: string;
  subsidiaryName: string;
  step: string; // texto en llano ("Desembarque")
  stepCode: string; // upload · unloading · dispatch · closure · inventory
  consNumber: string | null;
  kindLabel: string | null;
  receivedAt: Date | null;
  minutesLate: number;
  pct: number;
  progress: { total: number; unloaded: number; routed: number; closed: number } | null;
  /** Hallazgos del análisis guía por guía (solo los que importan). */
  findings: Finding[];
}

const LEVEL_ICON: Record<number, string> = { 1: '⏰', 2: '⚠️', 3: '🚨' };
const FINDING_ICON: Record<Finding['severity'], string> = { alta: '🔴', media: '🟠', info: '🟢' };

export const lateText = (min: number) => {
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return `${d} ${d === 1 ? 'día' : 'días'}${h ? ` ${h} h` : ''}`;
};

function uploadersLine(names: string[] | undefined): string | null {
  if (!names?.length) return null;
  return `Lo ${names.length === 1 ? 'sube' : 'suben'} normalmente: ${names.join(', ')}`;
}

/** Líneas de un consolidado (o del inventario) sin el encabezado de sucursal. */
function blockLines(b: AlertBlock): string[] {
  const lines: string[] = [];
  if (b.consNumber) {
    lines.push(`${b.kindLabel ?? 'Consolidado'} ${b.consNumber}${b.receivedAt ? ` · llegó el ${hermosilloDateTimeText(b.receivedAt)}` : ''}`);
    const p = b.progress;
    lines.push(p && p.total ? `Guías: ${p.total} · desembarque ${p.unloaded} · en ruta ${p.routed} · con cierre ${p.closed}` : 'Guías: no se ha subido');
  }
  const pct = b.pct > 0 && b.pct < 100 ? ` (va al ${b.pct}%)` : '';
  lines.push(`${LEVEL_ICON[b.level] ?? '⏰'} ${b.step}: venció hace ${lateText(b.minutesLate)}${pct}`);
  for (const f of b.findings) {
    if (f.severity === 'info') continue;
    if (f.code === 'no_subido' && b.stepCode === 'upload') continue; // ya lo dice la línea del paso
    lines.push(`${FINDING_ICON[f.severity]} ${f.text}`);
  }
  return lines;
}

/** Un mensaje para los grupos con todo lo nuevo o escalado, agrupado por sucursal. */
export function buildAlertDigest(input: AlertBlock[], uploaders: Map<string, string[]>, now: Date, opts: { test?: boolean } = {}): string {
  // FedEx a veces manda el mismo número como master y como aéreo: es el mismo consolidado, va una vez.
  const seen = new Set<string>();
  const blocks = input.filter((b) => {
    const k = `${b.subsidiaryId}|${b.consNumber ?? '-'}|${b.stepCode}|${b.kindLabel === 'F2 (carga)' ? 'f2' : 'm'}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const worst = Math.max(...blocks.map((b) => b.level));
  const bySub = new Map<string, AlertBlock[]>();
  for (const b of blocks) bySub.set(b.subsidiaryId, [...(bySub.get(b.subsidiaryId) ?? []), b]);
  const sections = [...bySub.values()]
    .sort((a, b) => Math.max(...b.map((x) => x.level)) - Math.max(...a.map((x) => x.level)) || a[0].subsidiaryName.localeCompare(b[0].subsidiaryName))
    .map((list) => {
      const head = [`📣 *${list[0].subsidiaryName}*`];
      const who = uploadersLine(uploaders.get(list[0].subsidiaryId));
      if (who) head.push(who);
      const body = [...list]
        .sort((a, b) => b.level - a.level || b.minutesLate - a.minutesLate)
        .map((b) => blockLines(b).join('\n'));
      return [...head, body.join('\n\n')].join('\n');
    });
  const n = blocks.length;
  const title = `${LEVEL_ICON[worst] ?? '⏰'} *Alertas operativas${opts.test ? ' (prueba)' : ''}* · ${hermosilloTimeText(now)}`;
  return [title, `${n} pendiente${n === 1 ? '' : 's'} con atraso`, '', sections.join('\n\n')].join('\n');
}

/** Mensaje de una sola alerta (campana / números de la sucursal). */
export function buildAlertMessage(b: AlertBlock, uploaders: string[] | undefined): string {
  const head = [`📣 *Alerta · ${b.subsidiaryName}*`];
  const who = uploadersLine(uploaders);
  if (who) head.push(who);
  return [...head, ...blockLines(b)].join('\n');
}

/**
 * Quién sube normalmente: las 1–2 personas con más consolidados/cargas subidos (la segunda solo si
 * sube al menos 1 de cada 5).
 */
export function pickUsualUploaders(counts: { name: string; n: number }[]): string[] {
  const sorted = [...counts].filter((c) => c.name && c.n > 0).sort((a, b) => b.n - a.n);
  if (!sorted.length) return [];
  const total = sorted.reduce((s, c) => s + c.n, 0);
  return [sorted[0].name, ...(sorted[1] && sorted[1].n / total >= 0.2 ? [sorted[1].name] : [])];
}
