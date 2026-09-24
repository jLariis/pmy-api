import { buildManualCountPrompt, CAUSE_CODE_MAP } from './manual-count-prompt.util';
import { DiagnosisRow, ManualCountReport } from './manual-count.types';

const row = (tn: string, over: Partial<DiagnosisRow> = {}): DiagnosisRow => ({
  trackingNumber: tn,
  manual: '08',
  fedexSays: '08',
  systemSays: '08',
  fedexLabel: 'DEX08',
  systemLabel: 'DEX08',
  charged: ['08'],
  expected: null,
  deliveredDay: null,
  verdict: 'ERROR_SISTEMA',
  cause: 'COBRO_DE_MAS',
  subCause: 'DEX08 con 1 visita en la semana',
  explanation: 'Se cobró DEX08 pero no debía cobrar.',
  chain: [{ step: 7, label: 'Ingreso registrado', ok: false, detail: 'Cobrado: DEX08.' }],
  cost: 52,
  incomeIds: ['i1'],
  ...over,
});

const report = (rows: DiagnosisRow[]): ManualCountReport => ({
  subsidiaryId: 'hmo',
  subsidiaryName: 'Hermosillo',
  day: '2026-09-22',
  fedexFailures: 0,
  totals: {
    manual: { POD: 60, '07': 0, '08': 2 },
    fedex: { POD: 60, '07': 0, '08': 2 },
    charged: { POD: 60, '07': 0, '08': 2 },
    byVerdict: { CUADRA: 60, ERROR_SISTEMA: 2, ERROR_CONTEO: 0, REGLA: 0, OTRO_DIA: 0 },
  },
  rows,
});

describe('buildManualCountPrompt', () => {
  const rows = [
    row('540148275693'),
    row('877368113055', { subCause: 'DEX08 con 2 visitas en la semana' }),
    row('111', { verdict: 'ERROR_CONTEO', cause: 'ERROR_CONTEO' }),
  ];

  it('incluye contexto, la causa elegida, sus guías y archivos sospechosos', () => {
    const p = buildManualCountPrompt({ report: report(rows), causes: ['COBRO_DE_MAS'] });
    expect(p).toContain('Hermosillo');
    expect(p).toContain('2026-09-22');
    expect(p).toContain('540148275693');
    expect(p).toContain('877368113055');
    for (const f of CAUSE_CODE_MAP.COBRO_DE_MAS.files) expect(p).toContain(f);
    expect(p).toContain('active=0');
  });

  it('nunca incluye errores de conteo ni reglas aunque se pidan', () => {
    const p = buildManualCountPrompt({ report: report(rows), causes: ['COBRO_DE_MAS', 'ERROR_CONTEO', 'REGLA_NO_COBRA'] });
    expect(p).not.toContain('111');
    expect(p).not.toContain(CAUSE_CODE_MAP.ERROR_CONTEO?.title ?? '§§');
  });

  it('topa a 10 guías por causa y dice cuántas más hay', () => {
    const many = Array.from({ length: 13 }, (_, i) => row(`T${String(i).padStart(3, '0')}`));
    const p = buildManualCountPrompt({ report: report(many), causes: ['COBRO_DE_MAS'] });
    expect(p).toContain('T009');
    expect(p).not.toContain('T010');
    expect(p).toContain('y 3 más');
  });

  it('es determinista', () => {
    const a = buildManualCountPrompt({ report: report(rows), causes: ['COBRO_DE_MAS'] });
    const b = buildManualCountPrompt({ report: report(rows), causes: ['COBRO_DE_MAS'] });
    expect(a).toBe(b);
  });

  it('sin causas de sistema → aviso claro', () => {
    const p = buildManualCountPrompt({ report: report([rows[2]]), causes: ['ERROR_CONTEO'] });
    expect(p).toContain('No hay errores del sistema');
  });
});
