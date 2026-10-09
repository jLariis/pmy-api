/**
 * Mensaje de WhatsApp para los grupos generales: UNA sola vez por revisión (cada 5 min) con todas
 * las alertas que se abrieron o subieron de nivel, agrupadas por sucursal. Así los grupos no se
 * llenan de un mensaje por consolidado.
 */

export interface DigestLine {
  level: number; // 1 vencido · 2 +30 min · 3 +60 min
  subsidiaryName: string;
  step: string; // texto en llano ("Desembarque")
  consNumber: string | null;
  minutesLate: number;
  pct: number;
}

const ICON: Record<number, string> = { 1: '⏰', 2: '⚠️', 3: '🚨' };

export const lateText = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`);

export function buildAlertDigest(lines: DigestLine[], now: Date): string {
  const hour = now.toLocaleTimeString('es-MX', { timeZone: 'America/Hermosillo', hour: '2-digit', minute: '2-digit' });
  const worst = Math.max(...lines.map((l) => l.level));
  const bySub = new Map<string, DigestLine[]>();
  for (const l of lines) bySub.set(l.subsidiaryName, [...(bySub.get(l.subsidiaryName) ?? []), l]);
  const blocks = [...bySub.entries()]
    .sort((a, b) => Math.max(...b[1].map((l) => l.level)) - Math.max(...a[1].map((l) => l.level)) || a[0].localeCompare(b[0]))
    .map(([sub, ls]) => {
      const rows = [...ls]
        .sort((a, b) => b.level - a.level || b.minutesLate - a.minutesLate)
        .map((l) => {
          const what = l.consNumber ? `${l.step} · ${l.consNumber}` : l.step;
          const pct = l.pct > 0 && l.pct < 100 ? ` (va al ${l.pct}%)` : '';
          return `${ICON[l.level] ?? '⏰'} ${what} — ${lateText(l.minutesLate)} de atraso${pct}`;
        });
      return [`*${sub}*`, ...rows].join('\n');
    });
  const n = lines.length;
  return [`${ICON[worst] ?? '⏰'} *Alertas operativas* · ${hour}`, `${n} pendiente${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'} o con más atraso:`, '', blocks.join('\n\n')].join('\n');
}
