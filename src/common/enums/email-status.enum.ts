/**
 * Estado del envío de correo asociado a una entidad (p.ej. una salida a ruta).
 * - NOT_SENT: aún no se intenta / no se ha enviado.
 * - SENT: aceptado por el SMTP (nodemailer `accepted`, sin `rejected`).
 * - ERROR: el envío falló (excepción o direcciones rechazadas).
 *
 * `email_log.status` solo usa SENT/ERROR (un intento siempre terminó en uno de
 * los dos); la columna denormalizada de la entidad sí puede quedar en NOT_SENT.
 */
export enum EmailStatus {
  NOT_SENT = 'not_sent',
  SENT = 'sent',
  ERROR = 'error',
}
