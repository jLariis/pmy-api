import { buildWarehouseExcelData, buildWarehousePdfData, carrierSections } from './warehouse.service';

// Salida a ruta de Bodega: el Excel lleva el JD de cada DHL (lo que se escanea); el PDF no.
describe('Bodega → salida a ruta: JD en Excel y separación por paquetería', () => {
  const pkgs = [
    { trackingNumber: '384382210348', shipmentType: 'fedex' },
    { trackingNumber: '3145418242', dhlUniqueId: 'JD014600012345678901', shipmentType: 'dhl' },
    { trackingNumber: '3145418242', dhlUniqueId: 'JD014600012345678902', shipmentType: 'dhl' },
  ];
  const header = { title: 'SALIDA A RUTA', subsidiary: { name: 'Bodega Obregon' }, excelShowsUniqueId: true };

  it('el Excel muestra el JD de cada pieza DHL', () => {
    const data: any = buildWarehouseExcelData(header, pkgs, 'America/Hermosillo');
    const codes = JSON.stringify(data);
    expect(codes).toContain('JD014600012345678901');
    expect(codes).toContain('JD014600012345678902');
  });

  it('el PDF sigue con la guía', () => {
    const data: any = buildWarehousePdfData(header, pkgs, 'America/Hermosillo');
    expect(JSON.stringify(data)).not.toContain('JD0146');
  });

  it('con la paquetería de cada guía se separa en FedEx y DHL', () => {
    expect(carrierSections(pkgs, header).map((s) => [s.label, s.items.length])).toEqual([['FEDEX', 1], ['DHL', 2]]);
  });

  it('sin la paquetería (el bug: no se leía de la BD) no se separaba', () => {
    const sinTipo = pkgs.map(({ shipmentType, ...p }) => p);
    expect(carrierSections(sinTipo, header)).toEqual([]);
  });
});
