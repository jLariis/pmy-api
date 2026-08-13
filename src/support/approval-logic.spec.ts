import {
  requiresApproval,
  initialApprovalStatus,
  isWorkingState,
  isBlockedByApproval,
  canApprove,
  isSuperRole,
} from './approval-logic';

describe('approval-logic', () => {
  const OLD = process.env.SUPPORT_APPROVAL_TYPES;
  afterEach(() => {
    if (OLD === undefined) delete process.env.SUPPORT_APPROVAL_TYPES;
    else process.env.SUPPORT_APPROVAL_TYPES = OLD;
  });

  it('solo mejora requiere aprobación (default)', () => {
    delete process.env.SUPPORT_APPROVAL_TYPES;
    expect(requiresApproval('mejora')).toBe(true);
    expect(requiresApproval('cambio')).toBe(false);
    expect(requiresApproval('error')).toBe(false);
    expect(initialApprovalStatus('mejora')).toBe('pendiente');
    expect(initialApprovalStatus('error')).toBe('no_requiere');
  });

  it('los tipos que requieren aprobación son configurables por env', () => {
    process.env.SUPPORT_APPROVAL_TYPES = 'mejora,cambio';
    expect(requiresApproval('cambio')).toBe(true);
  });

  it('isWorkingState marca los estados de trabajo', () => {
    expect(isWorkingState('en_progreso')).toBe(true);
    expect(isWorkingState('pendiente')).toBe(false);
    expect(isWorkingState('por_hacer')).toBe(false);
  });

  describe('isBlockedByApproval', () => {
    it('bloquea avanzar a trabajo si está pendiente y no es super', () => {
      expect(isBlockedByApproval('pendiente', 'en_progreso', false)).toBe(true);
    });
    it('el superadmin nunca queda bloqueado (override)', () => {
      expect(isBlockedByApproval('pendiente', 'en_progreso', true)).toBe(false);
    });
    it('no bloquea si ya está aprobado', () => {
      expect(isBlockedByApproval('aprobado', 'en_progreso', false)).toBe(false);
    });
    it('no bloquea moverse dentro del backlog (por_hacer)', () => {
      expect(isBlockedByApproval('pendiente', 'por_hacer', false)).toBe(false);
    });
  });

  it('canApprove: super o autorizador de la zona', () => {
    expect(canApprove(true, false)).toBe(true);
    expect(canApprove(false, true)).toBe(true);
    expect(canApprove(false, false)).toBe(false);
  });

  it('isSuperRole acepta el typo histórico "superamin"', () => {
    expect(isSuperRole('superadmin')).toBe(true);
    expect(isSuperRole('superamin')).toBe(true);
    expect(isSuperRole('admin')).toBe(false);
  });
});
