/** Número destino por defecto (formato internacional sin "+"): +52 644 423 0374. */
export const DEFAULT_DRIVER_PHONE = '526444230374';

/**
 * Plantilla por defecto del aviso al chofer. Los placeholders {…} los reemplaza
 * el frontend con los datos de la parada antes de abrir WhatsApp.
 */
export const DEFAULT_MESSAGE_TEMPLATE = `🚨 *PRIORIDAD DE ENTREGA — Posible Local Delay*

Chofer, la siguiente guía está por causar *Local Delay* y debe entregarse *HOY* sin falta:

📦 Guía(s): {guias}
👤 Cliente: {cliente}
📍 Dirección: {direccion} (CP {cp})
🕒 Vence: {vence}
🚚 Ruta: {ruta}

Dale máxima prioridad de entrega. De no entregarse hoy, el costo del paquete podría descontarse de tu sueldo.`;
