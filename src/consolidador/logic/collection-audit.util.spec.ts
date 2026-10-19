import { classifyCollectionAudit } from './collection-audit.util';

describe('classifyCollectionAudit', () => {
  it('ruta 31.5 → no cobra, aunque tenga cobro', () => {
    expect(classifyCollectionAudit({ is315: true, activeIncomes: 1 })).toBe('no_cobra_315');
  });
  it('sin cobro activo → sin_cobro', () => {
    expect(classifyCollectionAudit({ is315: false, activeIncomes: 0 })).toBe('sin_cobro');
  });
  it('un cobro → cobrada', () => {
    expect(classifyCollectionAudit({ is315: false, activeIncomes: 1 })).toBe('cobrada');
  });
  it('dos cobros → duplicada', () => {
    expect(classifyCollectionAudit({ is315: false, activeIncomes: 2 })).toBe('duplicada');
  });
});
