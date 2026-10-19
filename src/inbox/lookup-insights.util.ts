/**
 * Buscador de Correos: cómo se agrupa el estatus de cada guía y qué conviene avisarle a quien busca.
 * Puro para poder probarlo; el servicio solo junta los datos.
 */

export type GuideBucket = 'entregado' | 'dex' | 'devuelto' | 'en_ruta' | 'en_bodega' | 'pendiente' | 'otro';

const BUCKET: Record<string, GuideBucket> = {
  entregado: 'entregado',
  entregado_por_fedex: 'entregado',
  entregado_en_bodega: 'entregado',
  devuelto_a_fedex: 'devuelto',
  retorno_abandono_fedex: 'devuelto',
  rechazado: 'dex',
  direccion_incorrecta: 'dex',
  cliente_no_disponible: 'dex',
  cambio_fecha_solicitado: 'dex',
  demora_en_entrega: 'dex',
  empresa_cerrada: 'dex',
  restriccion_seguridad_ubicacion: 'dex',
  no_se_pudo_recolectar_el_cobro: 'dex',
  no_entregado: 'dex',
  cambio_domicilio: 'dex',
  en_ruta: 'en_ruta',
  en_transito: 'en_ruta',
  en_bodega: 'en_bodega',
  recibido_en_bodega: 'en_bodega',
  pendiente: 'pendiente',
};

export const bucketOf = (status: string | null | undefined): GuideBucket => BUCKET[String(status ?? '').toLowerCase()] ?? 'otro';

const DEX_CODE: Record<string, string> = {
  direccion_incorrecta: 'DEX03',
  restriccion_seguridad_ubicacion: 'DEX05',
  rechazado: 'DEX07',
  cliente_no_disponible: 'DEX08',
  cambio_fecha_solicitado: 'DEX17',
  empresa_cerrada: 'STAT42',
  demora_en_entrega: 'DEX84',
  no_se_pudo_recolectar_el_cobro: 'DEX93',
};

/** Código DEX a mostrar: el del último evento si lo trae, si no el que corresponde al estatus. */
export function dexCode(status: string | null | undefined, exceptionCode?: string | null): string | null {
  if (bucketOf(status) !== 'dex') return null;
  const code = String(exceptionCode ?? '').trim();
  if (code) return /^\d+$/.test(code) ? `DEX${code.padStart(2, '0')}` : code.toUpperCase();
  return DEX_CODE[String(status).toLowerCase()] ?? 'DEX';
}

export interface GuideFacts {
  status: string | null;
  unloaded: boolean;
  routed: boolean;
  closed: boolean;
  /** Suma de ingresos activos; null = no aplica (cargas cobran por carga, no por guía). */
  income: number | null;
  devolved: boolean;
  commitDateTime: Date | null;
  isHighValue: boolean;
  /** Otros registros activos de la misma guía (subida más de una vez). */
  otherRecords: number;
}

export interface Insight {
  severity: 'alta' | 'media' | 'info';
  text: string;
}

const COBRABLE = new Set(['entregado', 'rechazado']);

/** Lo que conviene saber de una guía para decidir qué hacer con ella. */
export function guideInsights(g: GuideFacts, now: Date): Insight[] {
  const out: Insight[] = [];
  const b = bucketOf(g.status);
  const finished = b === 'entregado' || b === 'devuelto';
  if (g.otherRecords > 0) out.push({ severity: 'media', text: `Esta guía está registrada ${g.otherRecords + 1} veces (se subió en más de un consolidado).` });
  if (g.routed && !g.unloaded) out.push({ severity: 'alta', text: 'Salió a ruta sin pasar por desembarque.' });
  if (b === 'entregado' && !g.unloaded && !g.routed) out.push({ severity: 'alta', text: 'Aparece entregada sin desembarque ni salida a ruta.' });
  if (!g.unloaded && !g.routed && !finished) out.push({ severity: 'media', text: 'Todavía no se desembarca.' });
  if (g.unloaded && !g.routed && !finished) out.push({ severity: 'media', text: 'Desembarcada, pero no ha salido a ruta.' });
  if (g.routed && !g.closed) out.push({ severity: 'media', text: 'Está en una salida a ruta que no se ha cerrado.' });
  if (g.income !== null && COBRABLE.has(String(g.status)) && g.income <= 0) out.push({ severity: 'alta', text: 'Tiene estatus cobrable y no tiene ingreso registrado.' });
  if (b === 'devuelto' && !g.devolved) out.push({ severity: 'info', text: 'Está como devuelta a FedEx pero no tiene registro de devolución.' });
  if (g.commitDateTime && !finished) {
    const days = Math.floor((g.commitDateTime.getTime() - now.getTime()) / 86_400_000);
    if (g.commitDateTime.getTime() < now.getTime()) out.push({ severity: 'alta', text: 'Ya venció y no se ha entregado.' });
    else if (days < 1) out.push({ severity: 'media', text: 'Vence hoy.' });
  }
  if (g.isHighValue && !finished) out.push({ severity: 'info', text: 'Es de alto valor.' });
  return out;
}

export type BucketCounts = Record<GuideBucket, number>;

export function countBuckets(statuses: (string | null)[]): BucketCounts {
  const out: BucketCounts = { entregado: 0, dex: 0, devuelto: 0, en_ruta: 0, en_bodega: 0, pendiente: 0, otro: 0 };
  for (const s of statuses) out[bucketOf(s)]++;
  return out;
}
