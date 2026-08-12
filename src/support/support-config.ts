import { DEFAULT_SLA_HOURS, TicketPriority, slaHoursFor, slaWarnFraction, computeSlaDueAt, computeSlaWarnAt } from './support-logic';
import { addBusinessHours, businessHoursEnabled, getBusinessHoursConfig } from './business-hours';

/**
 * Prioridad inicial por tipo de ticket. Un `error` no debería nacer con el mismo
 * SLA que una `mejora`. Override por env `SUPPORT_INITIAL_PRIORITY` con formato
 * "error=alta,cambio=media,mejora=baja,eliminar=baja".
 */
const DEFAULT_INITIAL_PRIORITY: Record<string, TicketPriority> = {
  error: 'alta',
  cambio: 'media',
  mejora: 'baja',
  eliminar: 'baja',
};

export function getInitialPriority(tipo: string | null | undefined): TicketPriority {
  const cfg = { ...DEFAULT_INITIAL_PRIORITY };
  const raw = process.env.SUPPORT_INITIAL_PRIORITY;
  if (raw) {
    for (const part of raw.split(',')) {
      const [k, v] = part.split('=').map((s) => s?.trim());
      if (k && v && ['baja', 'media', 'alta', 'urgente'].includes(v)) cfg[k] = v as TicketPriority;
    }
  }
  return cfg[tipo ?? ''] ?? 'media';
}

export interface SupportAgent {
  id: string;
  nombre: string;
  email: string;
  phone?: string;
}

/** Email del agente asignado por defecto a todo ticket nuevo. */
export const DEFAULT_ASSIGNEE_EMAIL = (process.env.SUPPORT_DEFAULT_EMAIL || 'admin@delyaqui.com').toLowerCase();

/**
 * Equipo de soporte (asignables + destinatarios). Config-driven vía env; el
 * default (`admin@delyaqui.com`) siempre está presente. Formato de SUPPORT_TEAM:
 *   "id:Nombre:email:telefono, id2:Nombre2:email2"
 * Cuando exista tabla/rol de agentes, sustituir por una consulta a company-settings.
 */
export function getSupportAgents(): SupportAgent[] {
  const agents: SupportAgent[] = [];

  const raw = process.env.SUPPORT_TEAM;
  if (raw) {
    for (const part of raw.split(',')) {
      const [id, nombre, email, phone] = part.split(':').map((s) => s?.trim());
      if (id && email) agents.push({ id, nombre: nombre || id, email: email.toLowerCase(), phone: phone || undefined });
    }
  }

  // Garantiza el agente default aunque no esté en SUPPORT_TEAM.
  if (!agents.some((a) => a.email === DEFAULT_ASSIGNEE_EMAIL)) {
    agents.unshift({
      id: 'admin',
      nombre: process.env.SUPPORT_DEFAULT_NAME || 'Administrador',
      email: DEFAULT_ASSIGNEE_EMAIL,
      phone: process.env.SUPPORT_WHATSAPP || undefined,
    });
  }

  return agents;
}

export function findAgentById(id: string): SupportAgent | undefined {
  return getSupportAgents().find((a) => a.id === id);
}

export function defaultAgent(): SupportAgent {
  return getSupportAgents().find((a) => a.email === DEFAULT_ASSIGNEE_EMAIL) ?? getSupportAgents()[0];
}

/**
 * Config de SLA (horas por prioridad). Override por env SUPPORT_SLA_HOURS con
 * formato "urgente=4,alta=24,media=72,baja=168".
 */
export function getSlaHours(): Record<TicketPriority, number> {
  const cfg = { ...DEFAULT_SLA_HOURS };
  const raw = process.env.SUPPORT_SLA_HOURS;
  if (raw) {
    for (const part of raw.split(',')) {
      const [k, v] = part.split('=').map((s) => s?.trim());
      const n = Number(v);
      if (k && Number.isFinite(n) && n > 0 && k in cfg) cfg[k as TicketPriority] = n;
    }
  }
  return cfg;
}

/**
 * SLA de **primera respuesta** en horas por prioridad. Override por env
 * `SUPPORT_FIRST_RESPONSE_HOURS` con formato "urgente=1,alta=4,media=8,baja=24".
 */
export const DEFAULT_FIRST_RESPONSE_HOURS: Record<TicketPriority, number> = {
  urgente: 1,
  alta: 4,
  media: 8,
  baja: 24,
};

export function getFirstResponseHours(): Record<TicketPriority, number> {
  const cfg = { ...DEFAULT_FIRST_RESPONSE_HOURS };
  const raw = process.env.SUPPORT_FIRST_RESPONSE_HOURS;
  if (raw) {
    for (const part of raw.split(',')) {
      const [k, v] = part.split('=').map((s) => s?.trim());
      const n = Number(v);
      if (k && Number.isFinite(n) && n > 0 && k in cfg) cfg[k as TicketPriority] = n;
    }
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Resolución de fechas SLA (respeta el flag de horario hábil)
// ---------------------------------------------------------------------------

/** Fecha límite de resolución: horario hábil si está activo, si no 24/7. */
export function slaDueAtFor(createdAt: Date, priority: string | null | undefined): Date {
  const cfg = getSlaHours();
  if (!businessHoursEnabled()) return computeSlaDueAt(createdAt, priority, cfg);
  return addBusinessHours(createdAt, slaHoursFor(priority, cfg), getBusinessHoursConfig());
}

/** Umbral de aviso preventivo (fracción del SLA), respetando horario hábil. */
export function slaWarnAtFor(createdAt: Date, priority: string | null | undefined): Date {
  const cfg = getSlaHours();
  if (!businessHoursEnabled()) return computeSlaWarnAt(createdAt, priority, cfg);
  return addBusinessHours(createdAt, slaHoursFor(priority, cfg) * slaWarnFraction(), getBusinessHoursConfig());
}

/** Fecha límite de primera respuesta, respetando horario hábil. */
export function firstResponseDueAtFor(createdAt: Date, priority: string | null | undefined): Date {
  const cfg = getFirstResponseHours();
  const hours = cfg[(priority ?? 'media') as TicketPriority] ?? cfg.media;
  if (!businessHoursEnabled()) return new Date(new Date(createdAt).getTime() + hours * 3600_000);
  return addBusinessHours(createdAt, hours, getBusinessHoursConfig());
}
