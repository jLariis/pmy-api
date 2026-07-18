import { DEFAULT_MESSAGE_TEMPLATE } from '../whatsapp-settings/whatsapp-defaults';

/**
 * Plantillas de WhatsApp por defecto. Placeholders soportados (el frontend los
 * reemplaza antes de enviar): {sucursal} {chofer} {fecha} {seguimiento} {link}
 * {ruta} {unidad} {cliente} {direccion} {cp} {guias} {vence}.
 */
export const WHATSAPP_TEMPLATE_DEFAULTS: { key: string; name: string; body: string }[] = [
  { key: 'prioridad_entrega', name: 'Prioridad de entrega (Local Delay)', body: DEFAULT_MESSAGE_TEMPLATE },
  { key: 'salida_ruta', name: 'Salida a Ruta', body:
`🚚 *Salida a Ruta* — {sucursal}
Chofer: {chofer}
Fecha: {fecha}
Ruta(s): {ruta}
Seguimiento: {seguimiento}
Ver en el sistema: {link}` },
  { key: 'desembarque', name: 'Desembarque', body:
`📦 *Desembarque* — {sucursal}
Unidad: {unidad}
Fecha: {fecha}
Seguimiento: {seguimiento}
Ver en el sistema: {link}` },
  { key: 'inventario', name: 'Inventario', body:
`📋 *Inventario* — {sucursal}
Fecha: {fecha}
Seguimiento: {seguimiento}
Ver en el sistema: {link}` },
  { key: 'reporte', name: 'Reporte', body:
`📄 *Reporte* — {sucursal}
Fecha: {fecha}
Ver en el sistema: {link}` },
];
