import { correctionAuthorId, correctionKind, isCorrectionIncome } from './income-correction.util';

describe('income-correction.util', () => {
  it('sin motivo no es corrección (ingreso automático)', () => {
    expect(isCorrectionIncome({ editReason: null })).toBe(false);
    expect(isCorrectionIncome({ editReason: '  ' })).toBe(false);
  });

  it('alta manual: agregado por quien lo creó', () => {
    const i = { editReason: 'no se generó en el cierre', createdById: 'u1' };
    expect(isCorrectionIncome(i)).toBe(true);
    expect(correctionKind(i)).toBe('agregado');
    expect(correctionAuthorId(i)).toBe('u1');
  });

  it('ajuste posterior: editado por quien lo ajustó', () => {
    const i = { editReason: 'monto mal', createdById: 'u1', updatedById: 'u2', originalCost: '52.00' };
    expect(correctionKind(i)).toBe('editado');
    expect(correctionAuthorId(i)).toBe('u2');
  });
});
