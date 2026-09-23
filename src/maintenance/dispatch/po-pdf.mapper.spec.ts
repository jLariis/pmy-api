import { mapPurchaseOrderToPdf } from './po-pdf.mapper';

describe('mapPurchaseOrderToPdf', () => {
  const po: any = {
    folio: 'OC-000123', status: 'autorizada', notes: 'Entregar en taller', createdAt: new Date('2026-09-20T18:00:00Z'),
    authorizedAt: new Date('2026-09-21T18:00:00Z'), authorizedBy: { name: 'Edgardo', lastName: 'Lugo' },
    subsidiary: { name: 'Hermosillo' }, request: { folio: 'SM-000010' },
    supplier: { name: 'Taller X', rfc: 'TXX010101AAA', address: 'Calle 1' },
    contact: { name: 'Juan', email: 'j@x.com', phone: '6621234567' },
    vehicle: { code: 'PMY13', name: 'Van 13', plateNumber: 'UU-9156A', brand: 'Nissan', model: 'Urvan', kms: 90500 },
    items: [
      { description: 'Balatas', quantity: 1, unitPrice: 1000, taxRate: 0.16, approved: true },
      { description: 'Discos', quantity: 2, unitPrice: 500, taxRate: 0.16, approved: false },
      { description: 'Mano de obra', quantity: 1, unitPrice: 500, taxRate: 0.16, approved: true },
    ],
  };

  it('solo incluye partidas aprobadas y totaliza con ellas', () => {
    const d = mapPurchaseOrderToPdf(po);
    expect(d.rows.map((r) => r.description)).toEqual(['Balatas', 'Mano de obra']);
    expect(d.rows[1].index).toBe(2);
    expect(d.total).toContain('1,740.00');
    expect(d.totalInWords).toBe('MIL SETECIENTOS CUARENTA PESOS 00/100 M.N.');
    expect(d.authorizedBy).toBe('Edgardo Lugo');
    expect(d.isDraft).toBe(false);
  });

  it('borrador lleva marca de no válida', () => {
    const d = mapPurchaseOrderToPdf({ ...po, status: 'borrador', authorizedAt: null, authorizedBy: null });
    expect(d.isDraft).toBe(true);
    expect(d.statusLabel).toContain('BORRADOR');
    expect(d.authorizedBy).toBe('');
  });
});
