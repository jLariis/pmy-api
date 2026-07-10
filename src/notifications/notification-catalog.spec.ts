import { resolvePresentation, auditToNotificationType } from './notification-catalog';

describe('notification-catalog', () => {
  it('returns catalog presentation for a known type', () => {
    const p = resolvePresentation('ticket.creada');
    expect(p.category).toBe('soporte');
    expect(p.channels).toEqual(['bell', 'email', 'whatsapp']);
  });

  it('falls back to operacion/bell for unknown types', () => {
    const p = resolvePresentation('operacion.tipo_inexistente');
    expect(p.category).toBe('operacion');
    expect(p.icon).toBe('bell');
    expect(p.channels).toEqual(['bell']);
  });

  it('overrides win over catalog', () => {
    const p = resolvePresentation('ticket.creada', { channels: ['bell'] });
    expect(p.channels).toEqual(['bell']);
  });

  it('bridges auth login/logout and generic operations', () => {
    expect(auditToNotificationType('auth', 'login')).toBe('auth.login');
    expect(auditToNotificationType('salidas_ruta', 'create')).toBe('operacion.salidas_ruta');
  });
});
