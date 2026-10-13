import { decideMasterRemoval } from './f2-master-removal.util';

describe('decideMasterRemoval (F2 sobre paquete del MISMO consolidado)', () => {
  it('paquete recién subido en el master (sin ruta ni ingreso) → se elimina del master', () => {
    expect(decideMasterRemoval({ hasDispatch: false, hasActiveIncome: false })).toEqual({ action: 'remove' });
  });

  it('paquete que ya salió a ruta → se conserva y se avisa (ya se trabajó)', () => {
    expect(decideMasterRemoval({ hasDispatch: true, hasActiveIncome: false })).toEqual({
      action: 'keep',
      reason: 'ya salió a ruta como paquete',
    });
  });

  it('paquete con ingreso vivo → se conserva y se avisa', () => {
    expect(decideMasterRemoval({ hasDispatch: false, hasActiveIncome: true })).toEqual({
      action: 'keep',
      reason: 'ya tiene ingreso como paquete',
    });
  });
});
