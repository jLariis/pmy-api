import { runTotals } from './manual-count-run.util';
import type { DiagnosisRow } from './manual-count.types';

const row = (p: Partial<DiagnosisRow>): DiagnosisRow => ({ trackingNumber: 'X', manual: null, verdict: 'CUADRA', cause: null, cost: null, ...p }) as DiagnosisRow;

describe('runTotals', () => {
  it('cuenta contadas, cuadran, diferencias y montos de falta / de más', () => {
    const t = runTotals(
      [
        row({ trackingNumber: '1', manual: 'POD' }),
        row({ trackingNumber: '2', manual: 'POD', verdict: 'ERROR_SISTEMA', cause: 'COBRO_FALTANTE' }),
        row({ trackingNumber: '3', manual: 'POD', verdict: 'ERROR_SISTEMA', cause: 'NOVAN_SIN_COBRO' }),
        row({ trackingNumber: '4', verdict: 'ERROR_SISTEMA', cause: 'DOBLE_PAQUETE_CARGA', cost: 122 }),
        row({ trackingNumber: '5', manual: '08', verdict: 'ERROR_SISTEMA', cause: 'COBRO_DE_MAS', cost: 52 }),
        row({ trackingNumber: '6', manual: 'POD', verdict: 'ERROR_CONTEO', cause: 'ERROR_CONTEO' }),
      ],
      122,
    );
    expect(t).toEqual({ counted: 5, matched: 1, differences: 5, missingAmount: 244, extraAmount: 174 });
  });

  it('por semana una guía con dos días cuenta una vez como contada', () => {
    const t = runTotals([row({ trackingNumber: '1', manual: '08', day: 'a' }), row({ trackingNumber: '1', manual: 'POD', day: 'b' })], 122);
    expect(t.counted).toBe(1);
  });
});
