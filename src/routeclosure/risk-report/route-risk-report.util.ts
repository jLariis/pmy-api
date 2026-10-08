import type { DoctorProblemCode } from '../closure-doctor.util';

/**
 * Reporte de las 7 pm "Rutas del día con posibles problemas" (lógica PURA, sin I/O).
 *
 * Recibe el diagnóstico de "Paquetes con problema" de cada salida del día y arma el correo en
 * llano: primero las rutas con guías por corregir, luego las que tienen guías sin resultado que
 * se quedarían "en ruta" en el cierre, y al final las que están bien.
 */

export interface RiskPackage {
  trackingNumber: string;
  kind: 'shipment' | 'charge';
  problems: DoctorProblemCode[];
  currentStatus: string;
  targetStatus: string | null;
  explanation: string[];
}

export interface RiskRouteInput {
  folio: string;
  subsidiaryName: string;
  drivers: string;
  total: number;
  is315: boolean;
  /** La salida ya tiene cierre. */
  closed: boolean;
  /** La sucursal tiene la opción "Cierre toma entregas y DEX del día siguiente". */
  untilNextDispatch: boolean;
  /** Guías que el cierre hoy vería sin resultado (en ruta, pendiente…). */
  withoutOutcome: string[];
  packages: RiskPackage[];
  /** No se pudo revisar la ruta (FedEx/BD). */
  error: string | null;
}

export interface RouteRiskReport {
  subject: string;
  html: string;
  totals: { routes: number; routesWithIssues: number; toFix: number; withoutOutcome: number; guides: number };
}

const PROBLEM_LABEL: Record<DoctorProblemCode, string> = {
  STATUS_BEHIND: 'Estatus atrasado',
  DELIVERED_BEFORE_ROUTE: 'Entregado antes de la ruta',
  HISTORY_MISSING: 'Falta en historial',
  INCOME_MISSING: 'Falta ingreso',
  CLOSURE_STALE: 'Resultado de otro día',
  WARNING: 'Revisar a mano',
};

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00.000Z`);
  return `${DAYS[d.getUTCDay()]} ${day.slice(8, 10)}-${MONTHS[d.getUTCMonth()]}`;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const statusText = (s: string | null) => (s ? s.replace(/_/g, ' ') : '—');

/** Guías que hay que corregir (lo que solo informa "entregado antes de la ruta" no cuenta). */
function toFixOf(r: RiskRouteInput): RiskPackage[] {
  return r.packages.filter((p) => p.problems.some((c) => c !== 'DELIVERED_BEFORE_ROUTE'));
}

/** Sin resultado + sucursal SIN la opción del día siguiente = riesgo de quedarse "en ruta". */
function atRisk(r: RiskRouteInput): boolean {
  return !r.untilNextDispatch && !r.closed && r.withoutOutcome.length > 0;
}

function hasIssues(r: RiskRouteInput): boolean {
  return !!r.error || toFixOf(r).length > 0 || atRisk(r);
}

function pill(text: string, bg: string, fg: string): string {
  return `<span style="display:inline-block;padding:1px 8px;margin:0 4px 2px 0;border-radius:10px;background:${bg};color:${fg};font-size:11px;font-weight:600">${esc(text)}</span>`;
}

function routeBlock(r: RiskRouteInput, base: string): string {
  const fix = toFixOf(r);
  const link = `${base}/operaciones/salidas-a-ruta?seguimiento=${encodeURIComponent(r.folio)}`;
  const tags: string[] = [];
  if (r.error) tags.push(pill('No se pudo revisar', '#fee2e2', '#991b1b'));
  if (fix.length) tags.push(pill(`${fix.length} por corregir`, '#fef3c7', '#92400e'));
  if (r.withoutOutcome.length) {
    tags.push(
      atRisk(r)
        ? pill(`${r.withoutOutcome.length} sin resultado`, '#ffedd5', '#9a3412')
        : pill(`${r.withoutOutcome.length} sin resultado aún`, '#f1f5f9', '#475569'),
    );
  }
  if (r.closed) tags.push(pill('Ya cerrada', '#dcfce7', '#166534'));
  if (r.is315) tags.push(pill('31.5', '#e0e7ff', '#3730a3'));

  const rows = fix
    .map(
      (p) => `<tr>
  <td style="padding:6px 8px;border-top:1px solid #e5e7eb;font-family:Consolas,monospace;white-space:nowrap">${esc(p.trackingNumber)}<br><span style="font-family:Arial,sans-serif;font-size:11px;color:#64748b">${p.kind === 'charge' ? 'Carga F2' : 'Paquete'}</span></td>
  <td style="padding:6px 8px;border-top:1px solid #e5e7eb">${p.problems.map((c) => pill(PROBLEM_LABEL[c] ?? c, '#f1f5f9', '#334155')).join('')}</td>
  <td style="padding:6px 8px;border-top:1px solid #e5e7eb;white-space:nowrap;font-size:12px">${esc(statusText(p.currentStatus))} → <b>${esc(statusText(p.targetStatus))}</b></td>
  <td style="padding:6px 8px;border-top:1px solid #e5e7eb;font-size:12px;color:#334155">${p.explanation.map(esc).join('<br>')}</td>
</tr>`,
    )
    .join('');

  const table = fix.length
    ? `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
  <tr style="background:#f8fafc;color:#64748b;font-size:11px;text-align:left">
    <th style="padding:6px 8px">Guía</th><th style="padding:6px 8px">Problema</th><th style="padding:6px 8px">Sistema → FedEx</th><th style="padding:6px 8px">Qué pasa</th>
  </tr>${rows}
</table>`
    : '';

  const risk = atRisk(r)
    ? `<p style="margin:8px 0 0;font-size:12px;color:#9a3412">Estas guías todavía no tienen resultado en FedEx. Si FedEx lo reporta hasta mañana, se quedarán "en ruta" en el cierre (la sucursal no tiene activada la opción del día siguiente): ${r.withoutOutcome.map(esc).join(', ')}</p>`
    : '';
  const error = r.error ? `<p style="margin:8px 0 0;font-size:12px;color:#991b1b">${esc(r.error)}</p>` : '';

  return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 12px">
  <div style="font-size:15px;font-weight:700;color:#0f172a">${esc(r.subsidiaryName)} · <a href="${esc(link)}" style="color:#b91c1c;text-decoration:none">${esc(r.folio)}</a></div>
  <div style="font-size:12px;color:#64748b;margin:2px 0 6px">${esc(r.drivers || 'Sin repartidor')} · ${r.total} guías</div>
  <div>${tags.join('')}</div>${error}${risk}${table}
</div>`;
}

export function buildRouteRiskReport(day: string, routes: RiskRouteInput[], frontendBase: string): RouteRiskReport {
  const base = (frontendBase || '').replace(/\/+$/, '');
  const label = dayLabel(day);
  const withIssues = routes.filter(hasIssues);
  const totals = {
    routes: routes.length,
    routesWithIssues: withIssues.length,
    toFix: routes.reduce((n, r) => n + toFixOf(r).length, 0),
    withoutOutcome: routes.reduce((n, r) => n + r.withoutOutcome.length, 0),
    guides: routes.reduce((n, r) => n + r.total, 0),
  };

  if (!routes.length) {
    return {
      subject: `Rutas del día ${label}: sin salidas a ruta`,
      html: `<p style="font-family:Arial,sans-serif">Hoy (${esc(label)}) no hubo salidas a ruta.</p>`,
      totals,
    };
  }

  // Más grave primero: por corregir, luego en riesgo; dentro, por sucursal.
  const score = (r: RiskRouteInput) => (r.error ? 1000 : 0) + toFixOf(r).length * 10 + (atRisk(r) ? r.withoutOutcome.length : 0);
  const sorted = [...withIssues].sort((a, b) => score(b) - score(a) || a.subsidiaryName.localeCompare(b.subsidiaryName));
  const ok = routes.filter((r) => !hasIssues(r));

  const subject = withIssues.length
    ? `Rutas del día ${label}: ${withIssues.length} de ${routes.length} rutas con posibles problemas`
    : `Rutas del día ${label}: las ${routes.length} rutas sin problemas`;

  const kpi = (n: number, text: string, color: string) =>
    `<td style="padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700;color:${color}">${n}</div><div style="font-size:11px;color:#64748b">${esc(text)}</div></td>`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:900px">
  <h2 style="margin:0 0 4px;font-size:18px">Rutas del día con posibles problemas</h2>
  <p style="margin:0 0 12px;font-size:13px;color:#475569">${esc(label)} · revisado contra FedEx a las 7 pm. Corrige desde el cierre de cada ruta con "Paquetes con problema".</p>
  <table cellpadding="0" cellspacing="6" style="margin:0 0 14px"><tr>
    ${kpi(totals.routes, 'rutas revisadas', '#0f172a')}
    ${kpi(totals.routesWithIssues, 'con posibles problemas', totals.routesWithIssues ? '#b91c1c' : '#166534')}
    ${kpi(totals.toFix, 'guías por corregir', totals.toFix ? '#92400e' : '#166534')}
    ${kpi(totals.withoutOutcome, 'guías sin resultado aún', '#475569')}
  </tr></table>
  ${sorted.map((r) => routeBlock(r, base)).join('')}
  ${
    ok.length
      ? `<p style="font-size:12px;color:#166534;margin:12px 0 0"><b>Sin problemas:</b> ${ok
          .map((r) => `${esc(r.subsidiaryName)} (${esc(r.folio)})`)
          .join(' · ')}</p>`
      : ''
  }
</div>`;

  return { subject, html, totals };
}
