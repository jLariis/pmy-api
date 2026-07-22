// p-limit es ESM puro y jest no transforma node_modules; lo stubeamos porque la cadena
// de imports de DevolutionsService lo arrastra (vía ShipmentsService). No lo usamos aquí.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { DevolutionsService } from './devolutions.service';

describe('DevolutionsService.renderReturningDocuments', () => {
  const baseInput = { subsidiaryName: 'Obregon', devolutions: [], collections: [] };

  it('usa el motor para pdf y excel', async () => {
    const render = jest.fn()
      .mockResolvedValueOnce({ format: 'pdf', mime: 'application/pdf', buffer: Buffer.from('PDF') })
      .mockResolvedValueOnce({ format: 'excel', mime: 'x', buffer: Buffer.from('XLSX') });
    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderReturningDocuments(baseInput);
    expect(render).toHaveBeenNthCalledWith(1, 'returning_pdf', expect.objectContaining({ subsidiaryName: 'Obregon' }));
    expect(render).toHaveBeenNthCalledWith(2, 'returning_excel', expect.any(Object));
    expect(out.pdf?.toString()).toBe('PDF');
    expect(out.excel?.toString()).toBe('XLSX');
  });

  it('sin buffer -> campo undefined (respaldo frontend)', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'pdf', mime: 'application/pdf' });
    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderReturningDocuments(baseInput);
    expect(out.pdf).toBeUndefined();
    expect(out.excel).toBeUndefined();
  });

  it('si el motor lanza, no propaga (campos undefined)', async () => {
    const render = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderReturningDocuments(baseInput);
    expect(out.pdf).toBeUndefined();
    expect(out.excel).toBeUndefined();
  });
});

describe('DevolutionsService.loadReturningInput (privado, vía any)', () => {
  function makeService(subsidiary: any, devolutions: any[], collections: any[]) {
    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.subsidiaryRepository = { findOneBy: jest.fn().mockResolvedValue(subsidiary) };
    svc.devolutionRepository = { find: jest.fn().mockResolvedValue(devolutions) };
    svc.collectionRepository = { find: jest.fn().mockResolvedValue(collections) };
    return svc;
  }

  it('mapea devoluciones (reason) y recolecciones (trackingNumber) del día en curso para la sucursal', async () => {
    const svc = makeService(
      { id: 'SUB-1', name: 'Cd. Obregon' },
      [{ trackingNumber: 'D1', reason: '03' }],
      [{ trackingNumber: 'C1' }, { trackingNumber: 'C2' }],
    );
    const input = await svc.loadReturningInput('SUB-1');
    expect(input.subsidiaryName).toBe('Cd. Obregon');
    expect(input.devolutions).toEqual([{ trackingNumber: 'D1', reason: '03' }]);
    expect(input.collections).toEqual([{ trackingNumber: 'C1' }, { trackingNumber: 'C2' }]);
    expect(svc.devolutionRepository.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ subsidiary: { id: 'SUB-1' } }),
    }));
  });

  it('sin devoluciones/recolecciones (gap: no hay sesión/lote persistido) -> arreglos vacíos, no rompe', async () => {
    const svc = makeService({ id: 'SUB-1', name: 'S' }, [], []);
    const input = await svc.loadReturningInput('SUB-1');
    expect(input.devolutions).toEqual([]);
    expect(input.collections).toEqual([]);
  });

  it('sin subsidiary encontrada -> subsidiaryName N/A (no lanza)', async () => {
    const svc = makeService(null, [], []);
    const input = await svc.loadReturningInput('SUB-X');
    expect(input.subsidiaryName).toBe('N/A');
  });
});

describe('DevolutionsService.sendByEmail — integración con Motor de Plantillas tras flag DOC_ENGINE_RETURNING', () => {
  const OLD_ENV = process.env.DOC_ENGINE_RETURNING;
  afterEach(() => { process.env.DOC_ENGINE_RETURNING = OLD_ENV; });

  function makeService() {
    const svc = Object.create(DevolutionsService.prototype) as any;
    svc.logger = { warn: jest.fn(), log: jest.fn() };
    svc.subsidiaryRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 'SUB-1', name: 'Obregon' }) };
    svc.mailService = { sendHighPriorityDevolutionsEmail: jest.fn().mockResolvedValue({ ok: true }) };
    return svc;
  }

  const pdfFile = { buffer: Buffer.from('legacy-pdf') } as any;
  const excelFile = { buffer: Buffer.from('legacy-excel') } as any;

  it('flag OFF (por defecto): usa los archivos subidos tal cual, sin tocar el motor', async () => {
    delete process.env.DOC_ENGINE_RETURNING;
    const svc = makeService();
    svc.renderReturningDocuments = jest.fn();
    await svc.sendByEmail(pdfFile, excelFile, 'Obregon', 'SUB-1');
    expect(svc.renderReturningDocuments).not.toHaveBeenCalled();
    expect(svc.mailService.sendHighPriorityDevolutionsEmail).toHaveBeenCalledWith(pdfFile, excelFile, { id: 'SUB-1', name: 'Obregon' });
  });

  it('flag ON: usa los buffers del motor cuando existen', async () => {
    process.env.DOC_ENGINE_RETURNING = 'true';
    const svc = makeService();
    svc.loadReturningInput = jest.fn().mockResolvedValue({ subsidiaryName: 'Obregon', devolutions: [], collections: [] });
    svc.renderReturningDocuments = jest.fn().mockResolvedValue({ pdf: Buffer.from('PDF'), excel: Buffer.from('XLSX') });
    await svc.sendByEmail(pdfFile, excelFile, 'Obregon', 'SUB-1');
    const [sentPdf, sentExcel] = svc.mailService.sendHighPriorityDevolutionsEmail.mock.calls[0];
    expect(sentPdf.buffer.toString()).toBe('PDF');
    expect(sentExcel.buffer.toString()).toBe('XLSX');
  });

  it('flag ON pero el motor falla: cae a los archivos subidos (no propaga)', async () => {
    process.env.DOC_ENGINE_RETURNING = 'true';
    const svc = makeService();
    svc.loadReturningInput = jest.fn().mockRejectedValue(new Error('boom'));
    await svc.sendByEmail(pdfFile, excelFile, 'Obregon', 'SUB-1');
    const [sentPdf, sentExcel] = svc.mailService.sendHighPriorityDevolutionsEmail.mock.calls[0];
    expect(sentPdf).toBe(pdfFile);
    expect(sentExcel).toBe(excelFile);
  });
});
