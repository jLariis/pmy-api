import {
  computeSlaDueAt,
  isSlaBreached,
  urgencyScore,
  slaHoursFor,
  DEFAULT_SLA_HOURS,
  isResolved,
} from './support-logic';

describe('support-logic', () => {
  const base = new Date('2026-07-31T12:00:00.000Z');

  describe('slaHoursFor', () => {
    it('usa los defaults por prioridad', () => {
      expect(slaHoursFor('urgente')).toBe(4);
      expect(slaHoursFor('alta')).toBe(24);
      expect(slaHoursFor('media')).toBe(72);
      expect(slaHoursFor('baja')).toBe(168);
    });
    it('cae a media ante prioridad desconocida o nula', () => {
      expect(slaHoursFor(undefined)).toBe(DEFAULT_SLA_HOURS.media);
      expect(slaHoursFor('inexistente')).toBe(DEFAULT_SLA_HOURS.media);
    });
    it('respeta config personalizada', () => {
      expect(slaHoursFor('urgente', { urgente: 2 } as any)).toBe(2);
    });
  });

  describe('computeSlaDueAt', () => {
    it('suma las horas de la prioridad a createdAt', () => {
      const due = computeSlaDueAt(base, 'urgente');
      expect(due.getTime()).toBe(base.getTime() + 4 * 3600_000);
    });
  });

  describe('isSlaBreached', () => {
    it('es true cuando slaDueAt ya pasó y sigue abierto', () => {
      const due = new Date(base.getTime() - 3600_000); // hace 1h
      expect(isSlaBreached({ estado: 'en_progreso', slaDueAt: due }, base)).toBe(true);
    });
    it('es false si aún no vence', () => {
      const due = new Date(base.getTime() + 3600_000);
      expect(isSlaBreached({ estado: 'en_progreso', slaDueAt: due }, base)).toBe(false);
    });
    it('nunca vence si está resuelto', () => {
      const due = new Date(base.getTime() - 10 * 3600_000);
      expect(isSlaBreached({ estado: 'completado', slaDueAt: due }, base)).toBe(false);
      expect(isSlaBreached({ estado: 'rechazado', slaDueAt: due }, base)).toBe(false);
    });
    it('es false sin slaDueAt', () => {
      expect(isSlaBreached({ estado: 'pendiente', slaDueAt: null }, base)).toBe(false);
    });
  });

  describe('isResolved', () => {
    it('detecta estados terminales', () => {
      expect(isResolved('completado')).toBe(true);
      expect(isResolved('rechazado')).toBe(true);
      expect(isResolved('pendiente')).toBe(false);
      expect(isResolved('en_revision')).toBe(false);
    });
  });

  describe('urgencyScore', () => {
    const t = (over: Partial<Parameters<typeof urgencyScore>[0]> = {}) => ({
      prioridad: 'media',
      tipo: 'mejora',
      createdAt: base,
      estado: 'pendiente',
      slaDueAt: null,
      ...over,
    });

    it('recién creado media/mejora = 30 + 5 + 0 = 35', () => {
      expect(urgencyScore(t(), base)).toBe(35);
    });

    it('urgente pesa más que baja', () => {
      const u = urgencyScore(t({ prioridad: 'urgente' }), base);
      const b = urgencyScore(t({ prioridad: 'baja' }), base);
      expect(u).toBeGreaterThan(b);
    });

    it('error pesa más que mejora a igualdad de lo demás', () => {
      expect(urgencyScore(t({ tipo: 'error' }), base)).toBeGreaterThan(urgencyScore(t({ tipo: 'mejora' }), base));
    });

    it('suma antigüedad topada a 48h', () => {
      const old = new Date(base.getTime() - 100 * 3600_000);
      // 30 + 5 + 48 (topado) = 83
      expect(urgencyScore(t({ createdAt: old }), base)).toBe(83);
    });

    it('suma 80 al estar vencido', () => {
      const due = new Date(base.getTime() - 3600_000);
      // 30 + 5 + 0 + 80 = 115
      expect(urgencyScore(t({ slaDueAt: due }), base)).toBe(115);
    });

    it('resueltos devuelven 0', () => {
      expect(urgencyScore(t({ estado: 'completado', prioridad: 'urgente' }), base)).toBe(0);
    });
  });
});
