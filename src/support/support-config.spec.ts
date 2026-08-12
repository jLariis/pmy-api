import { getInitialPriority, slaDueAtFor, firstResponseDueAtFor } from './support-config';

describe('getInitialPriority', () => {
  const OLD = process.env.SUPPORT_INITIAL_PRIORITY;
  afterEach(() => {
    if (OLD === undefined) delete process.env.SUPPORT_INITIAL_PRIORITY;
    else process.env.SUPPORT_INITIAL_PRIORITY = OLD;
  });

  it('un error nace con prioridad alta (SLA 24h, no 72h)', () => {
    delete process.env.SUPPORT_INITIAL_PRIORITY;
    expect(getInitialPriority('error')).toBe('alta');
  });

  it('cambio→media, mejora/eliminar→baja', () => {
    delete process.env.SUPPORT_INITIAL_PRIORITY;
    expect(getInitialPriority('cambio')).toBe('media');
    expect(getInitialPriority('mejora')).toBe('baja');
    expect(getInitialPriority('eliminar')).toBe('baja');
  });

  it('cae a media ante tipo desconocido/nulo', () => {
    delete process.env.SUPPORT_INITIAL_PRIORITY;
    expect(getInitialPriority(undefined)).toBe('media');
    expect(getInitialPriority('otro')).toBe('media');
  });

  it('respeta override por env', () => {
    process.env.SUPPORT_INITIAL_PRIORITY = 'error=urgente,mejora=media';
    expect(getInitialPriority('error')).toBe('urgente');
    expect(getInitialPriority('mejora')).toBe('media');
  });
});

describe('slaDueAtFor / firstResponseDueAtFor (flag horario hábil)', () => {
  const OLD = process.env.SUPPORT_SLA_BUSINESS_HOURS;
  afterEach(() => {
    if (OLD === undefined) delete process.env.SUPPORT_SLA_BUSINESS_HOURS;
    else process.env.SUPPORT_SLA_BUSINESS_HOURS = OLD;
  });

  it('con el flag desactivado cuenta 24/7 (exacto)', () => {
    process.env.SUPPORT_SLA_BUSINESS_HOURS = 'false';
    const created = new Date('2026-08-10T15:00:00.000Z');
    expect(slaDueAtFor(created, 'urgente').getTime()).toBe(created.getTime() + 4 * 3600_000);
    expect(firstResponseDueAtFor(created, 'urgente').getTime()).toBe(created.getTime() + 1 * 3600_000);
  });

  it('por default (horario hábil) pospone una creación en fin de semana', () => {
    delete process.env.SUPPORT_SLA_BUSINESS_HOURS;
    const created = new Date('2026-08-15T05:00:00.000Z'); // sábado madrugada MX
    const business = slaDueAtFor(created, 'urgente').getTime();
    expect(business).toBeGreaterThan(created.getTime() + 4 * 3600_000); // corrido al lunes
  });
});
