import { hermosilloDateTimeText } from '../common/hermosillo-text.util';
/**
 * Análisis de un consolidado que llegó por correo, guía por guía: qué falta o está fuera de orden
 * (no subido, rutas sin desembarque, entregadas sin pasar por nosotros…). Lo usa "Mandar aviso":
 * el sistema propone los hallazgos y la persona elige cuáles manda.
 */

export interface GuideFact {
  trackingNumber: string;
  status: string | null;
  unloaded: boolean;
  routed: boolean;
  closed: boolean;
}

export interface AnalysisInput {
  receivedAt: Date;
  announcedCount: number | null;
  guides: GuideFact[];
  now: Date;
}

export type FindingCode =
  | 'no_subido'
  | 'subida_parcial'
  | 'entregadas_sin_desembarque'
  | 'ruta_sin_desembarque'
  | 'desembarque_incompleto'
  | 'sin_ruta'
  | 'ruta_sin_cierre'
  | 'tipo_equivocado'
  | 'sin_pendientes';

export interface Finding {
  code: FindingCode;
  severity: 'alta' | 'media' | 'info';
  text: string;
  count: number;
  /** Algunas guías de ejemplo (máx. 10). */
  samples: string[];
}

const DELIVERED = new Set(['entregado', 'entregado_por_fedex', 'entregado_en_bodega']);
const FINAL = new Set([...DELIVERED, 'devuelto_a_fedex', 'retorno_abandono_fedex']);
const MAX_SAMPLES = 10;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ago = (min: number) => {
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h`;
  const d = Math.floor(min / 1440);
  return `${d} ${d === 1 ? 'día' : 'días'}`;
};

export function analyzeConsolidated(input: AnalysisInput): Finding[] {
  const g = input.guides;
  const out: Finding[] = [];
  const add = (code: FindingCode, severity: Finding['severity'], list: GuideFact[], text: string) =>
    out.push({ code, severity, text, count: list.length, samples: list.slice(0, MAX_SAMPLES).map((x) => x.trackingNumber) });

  if (!g.length) {
    const min = Math.max(0, Math.round((input.now.getTime() - input.receivedAt.getTime()) / 60_000));
    out.push({ code: 'no_subido', severity: 'alta', text: `No se ha subido: el correo llegó hace ${ago(min)}${input.announcedCount ? ` con ${input.announcedCount} guías` : ''}.`, count: input.announcedCount ?? 0, samples: [] });
    return out;
  }

  if (input.announcedCount && g.length < input.announcedCount) {
    out.push({ code: 'subida_parcial', severity: 'media', text: `Solo se subieron ${g.length} de ${input.announcedCount} guías anunciadas en el correo.`, count: input.announcedCount - g.length, samples: [] });
  }

  const deliveredOutside = g.filter((x) => DELIVERED.has(String(x.status)) && !x.unloaded && !x.routed);
  if (deliveredOutside.length) {
    add('entregadas_sin_desembarque', 'alta', deliveredOutside, `${plural(deliveredOutside.length, 'guía ya aparece entregada', 'guías ya aparecen entregadas')} sin desembarque ni salida a ruta.`);
  }

  const routedNotUnloaded = g.filter((x) => x.routed && !x.unloaded);
  if (routedNotUnloaded.length) {
    add('ruta_sin_desembarque', 'alta', routedNotUnloaded, `${plural(routedNotUnloaded.length, 'guía salió', 'guías salieron')} a ruta sin desembarque.`);
  }

  const missingUnload = g.filter((x) => !x.unloaded && !x.routed && !FINAL.has(String(x.status)));
  if (missingUnload.length) {
    add('desembarque_incompleto', 'media', missingUnload, `Faltan ${missingUnload.length} de ${g.length} guías por desembarcar.`);
  }

  const notRouted = g.filter((x) => x.unloaded && !x.routed && !FINAL.has(String(x.status)));
  if (notRouted.length) {
    add('sin_ruta', 'media', notRouted, `${plural(notRouted.length, 'guía desembarcada no ha', 'guías desembarcadas no han')} salido a ruta.`);
  }

  const openRoute = g.filter((x) => x.routed && !x.closed);
  if (openRoute.length) {
    add('ruta_sin_cierre', 'media', openRoute, `${plural(openRoute.length, 'guía está', 'guías están')} en ruta sin cierre.`);
  }

  if (!out.length) {
    out.push({ code: 'sin_pendientes', severity: 'info', text: `Sin pendientes: ${plural(g.length, 'guía subida', 'guías subidas')}, desembarcadas, en ruta y con cierre.`, count: 0, samples: [] });
  }
  return out;
}

/** ¿Se subió con otro tipo del anunciado? (F2 que quedó como paquete o master que quedó como carga). */
export function isWrongType(c: { kind: string; uploadedAsKind?: string | null }): boolean {
  return !!c.uploadedAsKind && c.uploadedAsKind !== (c.kind === 'f2' ? 'f2' : 'master');
}

export interface NoticeMessageInput {
  subsidiaryName: string;
  consNumber: string;
  kindLabel: string;
  receivedAt: Date;
  progress: { total: number; unloaded: number; routed: number; closed: number };
  findings: Finding[];
  note: string | null;
  senderName: string | null;
  withSamples: boolean;
  /** Reemplaza la línea de guías (p. ej. cuando se subió con otro tipo). */
  progressText?: string | null;
}

/** Siempre hora de Hermosillo: "07 de Octubre a las 12:39 p.m.". */
const fmt = (d: Date) => hermosilloDateTimeText(d);
const ICON: Record<Finding['severity'], string> = { alta: '🔴', media: '🟠', info: '🟢' };

/** Texto del aviso (WhatsApp / campana / correo). */
export function buildNoticeMessage(i: NoticeMessageInput): string {
  const p = i.progress;
  const lines = [
    `📣 *Aviso · ${i.subsidiaryName}*`,
    `${i.kindLabel} ${i.consNumber} · llegó el ${fmt(i.receivedAt)}`,
    i.progressText ?? (p.total ? `Guías: ${p.total} · desembarque ${p.unloaded} · en ruta ${p.routed} · con cierre ${p.closed}` : 'Guías: no se ha subido'),
    '',
    ...i.findings.map((f) => {
      const ex = i.withSamples && f.samples.length ? `\n   ${f.samples.join(', ')}${f.count > f.samples.length ? ', …' : ''}` : '';
      return `${ICON[f.severity]} ${f.text}${ex}`;
    }),
  ];
  if (i.note?.trim()) lines.push('', `📝 ${i.note.trim()}`);
  if (i.senderName) lines.push('', `— ${i.senderName}`);
  return lines.join('\n');
}
