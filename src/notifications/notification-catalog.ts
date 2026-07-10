import { Channel } from './notification.types';
import { NotificationCategory, NotificationSeverity } from 'src/entities/notification.entity';

export interface Presentation {
  category: NotificationCategory;
  icon: string;
  severity: NotificationSeverity;
  channels: Channel[];
}

/** Presentación por tipo de evento. La clave es el `type`. */
const CATALOG: Record<string, Partial<Presentation>> = {
  // ---- Soporte ----
  'ticket.creada':     { category: 'soporte', icon: 'life-buoy',     severity: 'info',    channels: ['bell', 'email', 'whatsapp'] },
  'ticket.asignado':   { category: 'soporte', icon: 'user-check',    severity: 'info',    channels: ['bell', 'email'] },
  'ticket.estado':     { category: 'soporte', icon: 'refresh-cw',    severity: 'info',    channels: ['bell', 'email'] },
  'ticket.comentario': { category: 'soporte', icon: 'message-square', severity: 'info',   channels: ['bell', 'email'] },
  'ticket.urgente':    { category: 'soporte', icon: 'alert-triangle', severity: 'warning', channels: ['whatsapp'] },
  // ---- Sesión ----
  'auth.login':        { category: 'sesion', icon: 'log-in',  severity: 'info', channels: ['bell'] },
  'auth.logout':       { category: 'sesion', icon: 'log-out', severity: 'info', channels: ['bell'] },
  // ---- Operación (módulos en vivo) ----
  'operacion.salidas_ruta': { category: 'operacion', icon: 'truck',      severity: 'info', channels: ['bell'] },
  'operacion.desembarques': { category: 'operacion', icon: 'package-open', severity: 'info', channels: ['bell'] },
  'operacion.consolidados': { category: 'operacion', icon: 'boxes',      severity: 'info', channels: ['bell'] },
  'operacion.devoluciones': { category: 'operacion', icon: 'undo-2',     severity: 'info', channels: ['bell'] },
  'operacion.recolecciones':{ category: 'operacion', icon: 'hand',       severity: 'info', channels: ['bell'] },
  'operacion.inventarios':  { category: 'operacion', icon: 'clipboard-list', severity: 'info', channels: ['bell'] },
  'operacion.cierre_ruta':  { category: 'operacion', icon: 'flag',       severity: 'info', channels: ['bell'] },
  'operacion.traslados':    { category: 'operacion', icon: 'arrow-left-right', severity: 'info', channels: ['bell'] },
  'operacion.gastos':       { category: 'operacion', icon: 'receipt',    severity: 'info', channels: ['bell'] },
};

const DEFAULT_PRESENTATION: Presentation = {
  category: 'operacion',
  icon: 'bell',
  severity: 'info',
  channels: ['bell'],
};

export function resolvePresentation(
  type: string,
  overrides: { category?: NotificationCategory; icon?: string; severity?: NotificationSeverity; channels?: Channel[] } = {},
): Presentation {
  const base = CATALOG[type] ?? {};
  return {
    category: overrides.category ?? base.category ?? DEFAULT_PRESENTATION.category,
    icon: overrides.icon ?? base.icon ?? DEFAULT_PRESENTATION.icon,
    severity: overrides.severity ?? base.severity ?? DEFAULT_PRESENTATION.severity,
    channels: overrides.channels ?? base.channels ?? DEFAULT_PRESENTATION.channels,
  };
}

/**
 * Puente auditoría→notificación: convierte el módulo de auditoría (string del
 * enum AuditModule, p.ej. 'salidas_ruta') + acción en un `type` de notificación.
 * Para operaciones usamos `operacion.<modulo>` como tipo genérico; el catálogo
 * se enriquece por módulo en Task 8.
 */
export function auditToNotificationType(module: string, action?: string): string {
  if (module === 'auth' && (action === 'login' || action === 'logout')) return `auth.${action}`;
  return `operacion.${module}`;
}
