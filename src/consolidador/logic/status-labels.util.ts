/**
 * Textos en llano de estatus internos y eventos de FedEx para el "Conteo manual vs
 * sistema": en vez de "otro estatus", se muestra exactamente qué tiene la guía.
 */

const SYSTEM_LABEL: Record<string, string> = {
  recoleccion: 'Recolección',
  recibido_en_bodega: 'Recibido en bodega',
  pendiente: 'Pendiente',
  en_ruta: 'En ruta',
  en_transito: 'En tránsito',
  entregado: 'Entregado',
  no_entregado: 'No entregado',
  desconocido: 'Desconocido',
  rechazado: 'DEX07 · Rechazado',
  devuelto_a_fedex: 'Devuelto a FedEx',
  es_ocurre: 'Es ocurre',
  entregado_en_bodega: 'Entregado en bodega',
  en_bodega: 'En bodega',
  retorno_abandono_fedex: 'Retorno / abandono FedEx',
  estacion_fedex: 'Estación FedEx',
  llegado_despues: 'Llegó después',
  direccion_incorrecta: 'DEX03 · Dirección incorrecta',
  cliente_no_disponible: 'DEX08 · Cliente no disponible',
  cambio_fecha_solicitado: 'DEX17 · Cambio de fecha solicitado',
  acargo_de_fedex: 'A cargo de FedEx',
  entregado_por_fedex: 'Entregado por FedEx',
  demora_en_entrega: 'Demora en entrega (84)',
  empresa_cerrada: 'Empresa cerrada',
  no_se_pudo_recolectar_el_cobro: 'DEX93 · No se pudo cobrar',
  restriccion_seguridad_ubicacion: 'DEX05 · Restricción de seguridad',
  otro: 'Otro (sin clasificar)',
  cambio_domicilio: 'Cambio de domicilio',
};

const humanize = (s: string) => {
  const t = s.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function systemStatusLabel(status: string | null | undefined): string {
  const st = String(status ?? '').toLowerCase().trim();
  if (!st) return 'Sin estatus';
  return SYSTEM_LABEL[st] ?? humanize(st);
}

const DEX_LABEL: Record<string, string> = {
  '03': 'Dirección incorrecta',
  '05': 'Restricción de seguridad',
  '07': 'Rechazado',
  '08': 'Cliente no disponible',
  '15': 'Negocio cerrado',
  '17': 'Cambio de fecha solicitado',
  '84': 'Demora en entrega',
  '93': 'No se pudo cobrar',
};

const EVENT_LABEL: Record<string, string> = {
  OC: 'Información enviada a FedEx',
  PU: 'Recolectado',
  DP: 'Salió de instalación FedEx',
  AR: 'Llegó a instalación FedEx',
  IT: 'En tránsito',
  OD: 'En vehículo de FedEx para entrega',
  DL: 'Entregado',
  HL: 'En espera en sucursal FedEx',
  HP: 'Listo para recoger (ocurre)',
  CC: 'Liberado por aduana',
  CD: 'Retenido en aduana',
  SE: 'Excepción de envío',
  RS: 'Devuelto al remitente',
  AF: 'En instalación FedEx',
  CA: 'Cancelado',
  PX: 'Recolección no realizada',
};

/** Evento de FedEx → "DEX03 · Dirección incorrecta" / "OD · En vehículo de FedEx para entrega". */
export function fedexEventLabel(scan: { eventType?: string; exceptionCode?: string; eventDescription?: string } | null | undefined): string {
  if (!scan) return 'Sin movimiento';
  const type = String(scan.eventType ?? '').trim();
  const code = String(scan.exceptionCode ?? '').trim();
  if (type === 'DE' && code) return `DEX${code} · ${DEX_LABEL[code] ?? scan.eventDescription ?? 'Excepción de entrega'}`;
  const text = EVENT_LABEL[type] ?? scan.eventDescription ?? 'Evento de FedEx';
  return type ? `${type} · ${text}` : text;
}
