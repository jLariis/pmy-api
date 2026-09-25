import { mapComparisonToPdf, mapRequestToRfqPdf } from './purchase-pdf.mappers';

const request: any = {
  folio: 'SOL-000007', type: 'compra', description: 'Aceite para flotilla', subsidiary: { name: 'Hermosillo' }, vehicle: null,
  items: [
    { id: 'ri2', description: 'Balero', quantity: 2, sortOrder: 1, unit: { name: 'Pieza', abbreviation: 'pza' }, product: { brand: 'SKF', partNumber: 'B-12' } },
    { id: 'ri1', description: 'Aceite 10W-30', quantity: 5, sortOrder: 0, unit: { name: 'Litro', abbreviation: null }, product: null, notes: 'sintético' },
  ],
};

describe('mapRequestToRfqPdf', () => {
  it('conceptos en orden, con unidad y detalle; sin unidad de vehículo en compras', () => {
    const d = mapRequestToRfqPdf(request, { name: 'AutoZone' }, { name: 'Ana', email: 'a@x.com', phone: '6621112233' } as any, { name: 'Gerardo Robles', email: 'g@pmy.mx' });
    expect(d.rows.map((r) => r.description)).toEqual(['Aceite 10W-30', 'Balero']);
    expect(d.rows[0]).toMatchObject({ unit: 'Litro', detail: 'sintético' });
    expect(d.rows[1]).toMatchObject({ unit: 'pza', detail: 'SKF · No. parte B-12' });
    expect(d.vehicle.label).toBe('');
    expect(d.requestType).toBe('Compra');
    expect(d.contact.phone).toBe('6621112233');
    expect(d.hasNotes).toBe(false);
  });
});

describe('mapComparisonToPdf', () => {
  it('celdas por proveedor, mejor precio, elegido y resumen de órdenes', () => {
    const c: any = {
      quotes: [
        { id: 'qA', supplierId: 'sA', supplierName: 'AutoZone', total: 348, covered: 2 },
        { id: 'qB', supplierId: 'sB', supplierName: 'Orealli', total: 406, covered: 1 },
      ],
      rows: [
        { requestItemId: 'ri1', description: 'Aceite', quantity: 5, bestQuoteItemId: 'a1', selectedQuoteItemId: 'a1',
          cells: {
            qA: { quoteItemId: 'a1', unitPrice: 60, quantity: 5, amount: 300, total: 348, availability: 'si', leadTimeDays: null, quality: 4 },
            qB: { quoteItemId: 'b1', unitPrice: 70, quantity: 5, amount: 350, total: 406, availability: 'sobre_pedido', leadTimeDays: 2, quality: null },
          } },
        { requestItemId: 'ri2', description: 'Balero', quantity: 2, bestQuoteItemId: null, selectedQuoteItemId: null,
          cells: { qA: { quoteItemId: 'a2', unitPrice: 500, quantity: 2, amount: 1000, total: 1160, availability: 'no', leadTimeDays: null, quality: null } } },
      ],
    };
    const d = mapComparisonToPdf(request, c, { ri1: 'L' }, 'Gerardo Robles');
    expect(d.suppliers.map((s) => s.covered)).toEqual(['2 de 2', '1 de 2']);
    expect(d.rows[0].cells[0]).toMatchObject({ has: true, cls: 'best sel', selected: true, quality: '★★★★☆' });
    expect(d.rows[0].cells[1]).toMatchObject({ availability: 'Sobre pedido (2 días)', cls: '' });
    expect(d.rows[1].cells[0]).toMatchObject({ noStock: true });
    expect(d.rows[1].cells[1]).toMatchObject({ has: false });
    expect(d.selection).toEqual([{ name: 'AutoZone', count: 1, total: expect.stringContaining('348.00') }]);
    expect(d.selectionTotal).toContain('348.00');
  });
});
