// p-limit es ESM puro y jest no transforma node_modules; lo stubeamos porque shipments.service
// lo importa a nivel de módulo. No lo usamos en este spec.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { ShipmentsService } from './shipments.service';

describe('ShipmentsService.exportReceived67Excel (B7, Motor con fallback a legacy)', () => {
  const rows = [
    { trackingNumber: 'T1', fecha67: '2026-07-20T18:00:00Z', diasDesde67: 2, status: 'en_bodega', isCharge: false },
  ];

  function svcWith(overrides: Record<string, any>) {
    const svc = Object.create(ShipmentsService.prototype) as any;
    svc.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    svc.exportReceived67ExcelLegacy = jest.fn().mockResolvedValue(Buffer.from('LEGACY'));
    Object.assign(svc, overrides);
    return svc;
  }

  const OLD_ENV = process.env;
  beforeEach(() => { process.env = { ...OLD_ENV }; });
  afterAll(() => { process.env = OLD_ENV; });

  it('flag OFF: nunca intenta el motor, va directo al legacy', async () => {
    delete process.env.DOC_ENGINE_RECEIVED_67;
    const render = jest.fn();
    const svc = svcWith({ templateService: { render } });
    const out = await svc.exportReceived67Excel(rows);
    expect(render).not.toHaveBeenCalled();
    expect(svc.exportReceived67ExcelLegacy).toHaveBeenCalledWith(rows);
    expect(out?.toString()).toBe('LEGACY');
  });

  it('flag ON + el motor entrega buffer: usa el buffer del motor (no llama al legacy)', async () => {
    process.env.DOC_ENGINE_RECEIVED_67 = 'true';
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x', buffer: Buffer.from('ENGINE_XLSX') });
    const svc = svcWith({ templateService: { render } });
    const out = await svc.exportReceived67Excel(rows);
    expect(render).toHaveBeenCalledWith('received_67_excel', expect.any(Object));
    expect(out?.toString()).toBe('ENGINE_XLSX');
    expect(svc.exportReceived67ExcelLegacy).not.toHaveBeenCalled();
  });

  it('flag ON + el motor no entrega buffer: cae a legacy', async () => {
    process.env.DOC_ENGINE_RECEIVED_67 = 'true';
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x' }); // sin buffer
    const svc = svcWith({ templateService: { render } });
    const out = await svc.exportReceived67Excel(rows);
    expect(svc.exportReceived67ExcelLegacy).toHaveBeenCalledWith(rows);
    expect(out?.toString()).toBe('LEGACY');
  });

  it('flag ON + el motor lanza: cae a legacy sin propagar el error', async () => {
    process.env.DOC_ENGINE_RECEIVED_67 = 'true';
    const render = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = svcWith({ templateService: { render } });
    const out = await svc.exportReceived67Excel(rows);
    expect(svc.exportReceived67ExcelLegacy).toHaveBeenCalledWith(rows);
    expect(out?.toString()).toBe('LEGACY');
    expect(svc.logger.warn).toHaveBeenCalled();
  });

  it('renderReceived67Excel: arma los datos con el mapper y devuelve el buffer del motor', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x', buffer: Buffer.from('X') });
    const svc = svcWith({ templateService: { render } });
    const buf = await svc.renderReceived67Excel(rows);
    expect(render).toHaveBeenCalledWith('received_67_excel', expect.objectContaining({
      rows: expect.arrayContaining([expect.objectContaining({ trackingNumber: 'T1', tipo: 'Envío' })]),
    }));
    expect(buf?.toString()).toBe('X');
  });
});
