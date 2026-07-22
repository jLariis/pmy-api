// p-limit es ESM puro y jest no transforma node_modules; lo stubeamos porque shipments.service
// lo importa a nivel de módulo. No lo usamos en este spec.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { ShipmentsService } from './shipments.service';

describe('ShipmentsService.exportNo67Shipments (B6, Motor con fallback a legacy)', () => {
  const shipments = [{ trackingNumber: 'T1', currentStatus: 'en_bodega', firstStatusDate: '2026-07-01T12:00:00Z' }];

  function svcWith(overrides: Record<string, any>) {
    const svc = Object.create(ShipmentsService.prototype) as any;
    svc.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    svc.exportNo67ShipmentsLegacy = jest.fn().mockResolvedValue('LEGACY_RESULT');
    Object.assign(svc, overrides);
    return svc;
  }

  function mkRes() {
    return { setHeader: jest.fn(), end: jest.fn() };
  }

  const OLD_ENV = process.env;
  beforeEach(() => { process.env = { ...OLD_ENV }; });
  afterAll(() => { process.env = OLD_ENV; });

  it('flag OFF: nunca intenta el motor, va directo al legacy', async () => {
    delete process.env.DOC_ENGINE_SHIPMENTS_NO67;
    const render = jest.fn();
    const svc = svcWith({ templateService: { render } });
    const res = mkRes();
    const out = await svc.exportNo67Shipments(shipments, res);
    expect(render).not.toHaveBeenCalled();
    expect(svc.exportNo67ShipmentsLegacy).toHaveBeenCalledWith(shipments, res);
    expect(out).toBe('LEGACY_RESULT');
  });

  it('flag ON + el motor entrega buffer: escribe headers + buffer en res, no cae a legacy', async () => {
    process.env.DOC_ENGINE_SHIPMENTS_NO67 = 'true';
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x', buffer: Buffer.from('ENGINE_XLSX') });
    const svc = svcWith({ templateService: { render } });
    const res = mkRes();
    const out = await svc.exportNo67Shipments(shipments, res);
    expect(render).toHaveBeenCalledWith('shipments_no67_excel', expect.any(Object));
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('shipments_sin_codigo_67_'));
    expect(res.end).toHaveBeenCalledWith(Buffer.from('ENGINE_XLSX'));
    expect(svc.exportNo67ShipmentsLegacy).not.toHaveBeenCalled();
    expect(out).toBe(res);
  });

  it('flag ON + el motor no entrega buffer: cae a legacy', async () => {
    process.env.DOC_ENGINE_SHIPMENTS_NO67 = 'true';
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x' }); // sin buffer
    const svc = svcWith({ templateService: { render } });
    const res = mkRes();
    const out = await svc.exportNo67Shipments(shipments, res);
    expect(svc.exportNo67ShipmentsLegacy).toHaveBeenCalledWith(shipments, res);
    expect(res.end).not.toHaveBeenCalled();
    expect(out).toBe('LEGACY_RESULT');
  });

  it('flag ON + el motor lanza: cae a legacy sin propagar el error', async () => {
    process.env.DOC_ENGINE_SHIPMENTS_NO67 = 'true';
    const render = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = svcWith({ templateService: { render } });
    const res = mkRes();
    const out = await svc.exportNo67Shipments(shipments, res);
    expect(svc.exportNo67ShipmentsLegacy).toHaveBeenCalledWith(shipments, res);
    expect(out).toBe('LEGACY_RESULT');
  });

  it('renderShipmentsNo67Excel: arma los datos con el mapper y devuelve el buffer del motor', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x', buffer: Buffer.from('X') });
    const svc = svcWith({ templateService: { render } });
    const buf = await svc.renderShipmentsNo67Excel(shipments);
    expect(render).toHaveBeenCalledWith('shipments_no67_excel', expect.objectContaining({
      totalCount: 1,
      detailRows: expect.arrayContaining([expect.objectContaining({ trackingNumber: 'T1' })]),
    }));
    expect(buf?.toString()).toBe('X');
  });
});
