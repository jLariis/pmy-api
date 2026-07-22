// p-limit es ESM puro y jest no transforma node_modules; lo stubeamos porque la cadena
// de imports de PackageDispatchService lo arrastra (vía shipments.service). No lo usamos aquí.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { PackageDispatchService } from './package-dispatch.service';

describe('PackageDispatchService.generateDriverReportExcel (B3, Motor con fallback a legacy)', () => {
  const rawData = { summaryData: [{ driverName: 'Juan', total: '1', delivered: '1', returned: '0' }], detailsData: [] };

  function svcWith(overrides: Record<string, any>) {
    const svc = Object.create(PackageDispatchService.prototype) as any;
    svc.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    svc.fetchDriverReportRawData = jest.fn().mockResolvedValue(rawData);
    svc.generateDriverReportExcelLegacy = jest.fn().mockResolvedValue(Buffer.from('LEGACY_XLSX'));
    Object.assign(svc, overrides);
    return svc;
  }

  it('usa el motor cuando entrega buffer (no cae a legacy)', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x', buffer: Buffer.from('ENGINE_XLSX') });
    const svc = svcWith({ templateService: { render } });
    const out = await svc.generateDriverReportExcel('2026-07-01', '2026-07-20', 'sub-1');
    expect(render).toHaveBeenCalledWith('driver_report_excel', expect.any(Object));
    expect(svc.fetchDriverReportRawData).toHaveBeenCalledWith('2026-07-01', '2026-07-20', 'sub-1');
    expect(out.toString()).toBe('ENGINE_XLSX');
    expect(svc.generateDriverReportExcelLegacy).not.toHaveBeenCalled();
  });

  it('sin buffer del motor → cae al legacy (mismos argumentos)', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x' }); // sin buffer
    const svc = svcWith({ templateService: { render } });
    const out = await svc.generateDriverReportExcel('2026-07-01', '2026-07-20', 'sub-1');
    expect(svc.generateDriverReportExcelLegacy).toHaveBeenCalledWith('2026-07-01', '2026-07-20', 'sub-1');
    expect(out.toString()).toBe('LEGACY_XLSX');
  });

  it('si el motor lanza → cae al legacy sin propagar el error', async () => {
    const render = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = svcWith({ templateService: { render } });
    const out = await svc.generateDriverReportExcel('2026-07-01', '2026-07-20', 'sub-1');
    expect(svc.generateDriverReportExcelLegacy).toHaveBeenCalledWith('2026-07-01', '2026-07-20', 'sub-1');
    expect(out.toString()).toBe('LEGACY_XLSX');
  });

  it('si fetchDriverReportRawData lanza (query rota) → también cae al legacy', async () => {
    const render = jest.fn();
    const svc = svcWith({ templateService: { render }, fetchDriverReportRawData: jest.fn().mockRejectedValue(new Error('db down')) });
    const out = await svc.generateDriverReportExcel('2026-07-01', '2026-07-20', 'sub-1');
    expect(render).not.toHaveBeenCalled();
    expect(svc.generateDriverReportExcelLegacy).toHaveBeenCalledWith('2026-07-01', '2026-07-20', 'sub-1');
    expect(out.toString()).toBe('LEGACY_XLSX');
  });
});
