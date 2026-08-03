import { DEFAULT_SLA_HOURS, TicketPriority } from './support-logic';

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
