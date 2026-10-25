import { buildWarehousePdfData, carrierSections, joinHtmlPages } from './warehouse.service';

const pkg = (trackingNumber: string, shipmentType: string, isCharge = false) =>
  ({ trackingNumber, shipmentType, isCharge, recipientName: 'X', recipientZip: '85000' });

describe('Bodega → Salida separada por paquetería', () => {
  const grouped = [pkg('F1', 'fedex'), pkg('C1', '', true), pkg('D1', 'dhl')];
  const ruta = { title: 'SALIDA A RUTA', subsidiary: { name: 'Bodega Obregon' } };

  it('una sección por paquetería cuando vienen agrupadas (la F2 es FedEx)', () => {
    expect(carrierSections(grouped, ruta).map((s) => [s.label, s.items.map((p) => p.trackingNumber)])).toEqual([
      ['FEDEX', ['F1', 'C1']],
      ['DHL', ['D1']],
    ]);
  });

  it('documento único si están mezcladas, si hay una sola paquetería, sin paquetería o en traspasos', () => {
    expect(carrierSections([pkg('F1', 'fedex'), pkg('D1', 'dhl'), pkg('F2', 'fedex')], ruta)).toEqual([]);
    expect(carrierSections([pkg('F1', 'fedex'), pkg('F2', 'fedex')], ruta)).toEqual([]);
    expect(carrierSections([pkg('F1', 'fedex'), pkg('X1', '')], ruta)).toEqual([]);
    expect(carrierSections(grouped, { ...ruta, blankMissing: true })).toEqual([]);
  });

  it('cada sección numera desde 1 y cuenta solo sus guías', () => {
    const [fedex, dhl] = carrierSections(grouped, ruta);
    const d = buildWarehousePdfData({ ...ruta, title: 'SALIDA A RUTA · DHL' }, dhl.items, 'America/Hermosillo');
    expect([d.title, d.totalPackages, d.rows[0].index]).toEqual(['SALIDA A RUTA · DHL', 1, 1]);
    expect(buildWarehousePdfData(ruta, fedex.items, 'America/Hermosillo').totalPackages).toBe(2);
  });

  it('une los HTML con salto de página y un solo <head>', () => {
    const h = (b: string) => `<!doctype html><html><head><style>x</style></head><body>${b}</body></html>`;
    const out = joinHtmlPages([h('A'), h('B')]);
    expect(out).toBe('<!doctype html><html><head><style>x</style></head><body>A<div style="break-before:page"></div>B</body></html>');
  });
});
