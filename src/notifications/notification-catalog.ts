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
