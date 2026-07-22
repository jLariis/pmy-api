import { ResportsService } from './resports.service';

/** Instancia sin pasar por Nest DI (los repos reales requieren DB); aislado del baseline roto
 * de `resports.service.spec.ts`/`resports.controller.spec.ts` (DI de ExpenseRepository), que ya
 * fallaba antes de este lote y no se toca aquí. */
function makeService(aggregates: any) {
  const svc = Object.create(ResportsService.prototype) as any;
  svc.logger = { warn: jest.fn() };
  svc.loadIncomeStatementAggregates = jest.fn().mockResolvedValue(aggregates);
  return svc;
}

const baseAggregates = {
  subsidiaryName: 'Cd. Obregon',
  dateKeys: ['2026-07-18', '2026-07-19'],
  incomeMatrix: { 'Envío': { '2026-07-18': 100 } },
  expenseMatrix: {},
  detailRows: [],
};

describe('ResportsService.renderIncomeStatementViaEngine', () => {
  it('usa el motor para el Excel de Estado de Resultados', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x', buffer: Buffer.from('XLSX') });
    const svc = makeService(baseAggregates);
    svc.templateService = { render };
    const buf = await svc.renderIncomeStatementViaEngine(['sub-1'], '2026-07-18', '2026-07-19');
    expect(render).toHaveBeenCalledWith('income_statement_excel', expect.objectContaining({ subsidiaryName: 'Cd. Obregon' }));
    expect(buf?.toString()).toBe('XLSX');
  });

  it('sin buffer → undefined', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x' }); // sin buffer
    const svc = makeService(baseAggregates);
    svc.templateService = { render };
    const buf = await svc.renderIncomeStatementViaEngine(['sub-1'], '2026-07-18', '2026-07-19');
    expect(buf).toBeUndefined();
  });
});

describe('ResportsService.generateIncomeStatementReport (flag + fallback)', () => {
  const OLD_ENV = process.env.DOC_ENGINE_INCOME_STATEMENT;
  afterEach(() => { process.env.DOC_ENGINE_INCOME_STATEMENT = OLD_ENV; });

  it('flag OFF (default): usa directo el armado legacy, sin llamar al motor', async () => {
    delete process.env.DOC_ENGINE_INCOME_STATEMENT;
    const svc = makeService(baseAggregates);
    const render = jest.fn();
    svc.templateService = { render };
    const legacyBuf = Buffer.from('LEGACY');
    svc.generateIncomeStatementReportLegacy = jest.fn().mockResolvedValue(legacyBuf);
    const out = await svc.generateIncomeStatementReport(['sub-1'], '2026-07-18', '2026-07-19');
    expect(render).not.toHaveBeenCalled();
    expect(out).toBe(legacyBuf);
  });

  it('flag ON + motor entrega buffer: usa el buffer del motor (no llama al legacy)', async () => {
    process.env.DOC_ENGINE_INCOME_STATEMENT = 'true';
    const svc = makeService(baseAggregates);
    const engineBuf = Buffer.from('ENGINE');
    svc.templateService = { render: jest.fn().mockResolvedValue({ format: 'excel', mime: 'x', buffer: engineBuf }) };
    svc.generateIncomeStatementReportLegacy = jest.fn().mockResolvedValue(Buffer.from('LEGACY'));
    const out = await svc.generateIncomeStatementReport(['sub-1'], '2026-07-18', '2026-07-19');
    expect(out).toBe(engineBuf);
    expect(svc.generateIncomeStatementReportLegacy).not.toHaveBeenCalled();
  });

  it('flag ON + motor sin buffer: cae a legacy', async () => {
    process.env.DOC_ENGINE_INCOME_STATEMENT = 'true';
    const svc = makeService(baseAggregates);
    svc.templateService = { render: jest.fn().mockResolvedValue({ format: 'excel', mime: 'x' }) };
    const legacyBuf = Buffer.from('LEGACY');
    svc.generateIncomeStatementReportLegacy = jest.fn().mockResolvedValue(legacyBuf);
    const out = await svc.generateIncomeStatementReport(['sub-1'], '2026-07-18', '2026-07-19');
    expect(out).toBe(legacyBuf);
  });

  it('flag ON + motor lanza: no propaga, cae a legacy', async () => {
    process.env.DOC_ENGINE_INCOME_STATEMENT = 'true';
    const svc = makeService(baseAggregates);
    svc.templateService = { render: jest.fn().mockRejectedValue(new Error('boom')) };
    const legacyBuf = Buffer.from('LEGACY');
    svc.generateIncomeStatementReportLegacy = jest.fn().mockResolvedValue(legacyBuf);
    const out = await svc.generateIncomeStatementReport(['sub-1'], '2026-07-18', '2026-07-19');
    expect(out).toBe(legacyBuf);
    expect(svc.logger.warn).toHaveBeenCalled();
  });
});
