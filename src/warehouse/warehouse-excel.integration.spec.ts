// src/warehouse/warehouse-excel.integration.spec.ts
import { WarehouseService } from './warehouse.service';
import { Workbook } from 'exceljs';

describe('WarehouseService.generateExcelBuffer (motor con fallback a legacy)', () => {
  const header: any = { title: 'Salida a Ruta', routes: [{ name: 'R1' }], drivers: [{ name: 'Juan' }], vehicle: { name: 'ECON-01' } };
  const packages: any[] = [
    { trackingNumber: 'T1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000', recipientPhone: '644', isCharge: true, payment: { amount: 100 } },
  ];

  function makeService() {
    const svc = Object.create(WarehouseService.prototype) as any;
    svc.timeZone = 'America/Hermosillo';
    return svc;
  }

  it('usa el motor cuando devuelve buffer', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x', buffer: Buffer.from('XLSX-DEL-MOTOR') });
    const svc = makeService();
    svc.templateService = { render };
    const buf: Buffer = await svc.generateExcelBuffer(header, packages);
    expect(render).toHaveBeenCalledWith('warehouse_dispatch_excel', expect.objectContaining({ title: 'Salida a Ruta', totalPackages: 1 }));
    expect(buf.toString()).toBe('XLSX-DEL-MOTOR');
  });

  it('sin buffer del motor -> cae al generador legacy (exceljs)', async () => {
    const render = jest.fn().mockResolvedValue({ format: 'excel', mime: 'x' }); // sin buffer
    const svc = makeService();
    svc.templateService = { render };
    const buf: Buffer = await svc.generateExcelBuffer(header, packages);
    const wb = new Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Despacho')!;
    expect(ws.getCell('A1').value).toBe('🚚 Salida a Ruta');
    expect((ws.getCell('A1').fill as any).fgColor.argb).toBe('ef883a');
  });

  it('si el motor lanza -> cae al generador legacy (no propaga)', async () => {
    const render = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = makeService();
    svc.templateService = { render };
    const buf: Buffer = await svc.generateExcelBuffer(header, packages);
    const wb = new Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Despacho')!;
    expect(ws.getCell('A1').value).toBe('🚚 Salida a Ruta');
  });
});
