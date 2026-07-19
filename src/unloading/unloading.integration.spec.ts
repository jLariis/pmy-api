// p-limit es ESM puro y jest no transforma node_modules; lo stubeamos porque la cadena
// de imports de UnloadingService lo arrastra (vía shipments.service). No lo usamos aquí.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { UnloadingService } from './unloading.service';

describe('UnloadingService.renderUnloadingDocuments', () => {
  const baseInput = { subsidiaryName: 'Obregon', trackingNumber: 'S', packages: [] };

  it('usa el motor para pdf y excel', async () => {
    const render = jest.fn()
      .mockResolvedValueOnce({ format: 'pdf', mime: 'application/pdf', buffer: Buffer.from('PDF') })
      .mockResolvedValueOnce({ format: 'excel', mime: 'x', buffer: Buffer.from('XLSX') });
    const svc = Object.create(UnloadingService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderUnloadingDocuments(baseInput);
    expect(render).toHaveBeenNthCalledWith(1, 'unloading_pdf', expect.objectContaining({ subsidiaryName: 'Obregon' }));
    expect(render).toHaveBeenNthCalledWith(2, 'unloading_excel', expect.any(Object));
    expect(out.pdf?.toString()).toBe('PDF');
    expect(out.excel?.toString()).toBe('XLSX');
  });

  it('sin buffer → campo undefined (respaldo frontend)', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'pdf', mime: 'application/pdf' }); // sin buffer
    const svc = Object.create(UnloadingService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderUnloadingDocuments(baseInput);
    expect(out.pdf).toBeUndefined();
    expect(out.excel).toBeUndefined();
  });

  it('si el motor lanza, no propaga (campos undefined)', async () => {
    const render = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = Object.create(UnloadingService.prototype) as any;
    svc.templateService = { render };
    const out = await svc.renderUnloadingDocuments(baseInput);
    expect(out.pdf).toBeUndefined();
    expect(out.excel).toBeUndefined();
  });
});
