import { fedexEventLabel, systemStatusLabel } from './status-labels.util';

describe('systemStatusLabel', () => {
  it('traduce los estatus internos a texto llano', () => {
    expect(systemStatusLabel('en_ruta')).toBe('En ruta');
    expect(systemStatusLabel('devuelto_a_fedex')).toBe('Devuelto a FedEx');
    expect(systemStatusLabel('cliente_no_disponible')).toBe('DEX08 · Cliente no disponible');
    expect(systemStatusLabel('direccion_incorrecta')).toBe('DEX03 · Dirección incorrecta');
  });
  it('estatus desconocido → se muestra legible, no "otro"', () => {
    expect(systemStatusLabel('algo_nuevo')).toBe('Algo nuevo');
    expect(systemStatusLabel(null)).toBe('Sin estatus');
  });
});

describe('fedexEventLabel', () => {
  it('traduce el evento de FedEx con su código', () => {
    expect(fedexEventLabel({ eventType: 'OD' })).toBe('OD · En vehículo de FedEx para entrega');
    expect(fedexEventLabel({ eventType: 'DE', exceptionCode: '03' })).toBe('DEX03 · Dirección incorrecta');
    expect(fedexEventLabel({ eventType: 'DE', exceptionCode: '08' })).toBe('DEX08 · Cliente no disponible');
    expect(fedexEventLabel({ eventType: 'DL' })).toBe('DL · Entregado');
  });
  it('evento sin traducción → usa la descripción de FedEx', () => {
    expect(fedexEventLabel({ eventType: 'ZZ', eventDescription: 'Something new' })).toBe('ZZ · Something new');
  });
});
