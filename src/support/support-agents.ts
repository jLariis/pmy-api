export interface SupportAgent { id: string; nombre: string; email: string; phone?: string }

/**
 * Equipo de soporte (asignables + destinatarios). Config-driven: hoy solo Javier.
 * Cuando exista un rol/tabla de agentes, reemplazar por una consulta.
 */
export function getSupportAgents(): SupportAgent[] {
  const email = process.env.SUPPORT_TEAM_EMAIL || 'javier.lopez@derevo.com.mx';
  const phone = process.env.SUPPORT_WHATSAPP || undefined;
  return [{ id: 'javier', nombre: 'Javier López', email, phone }];
}
