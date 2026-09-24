import { expedienteStage } from './expediente-stage.util';

describe('expedienteStage', () => {
  it('sin cotizaciones → cotizando, captura cotizaciones', () =>
    expect(expedienteStage({ requestStatus: 'abierta', quotesCount: 0, po: null })).toMatchObject({
      stage: 'cotizando', step: 'cotizaciones', waitingOn: 'captura', rejected: false,
    }));

  it('con 2 cotizaciones → comparar y elegir', () =>
    expect(expedienteStage({ requestStatus: 'en_cotizacion', quotesCount: 2, po: null }).nextStep).toMatch(/elige/i));

  it('orden pendiente → por autorizar, espera al autorizador', () =>
    expect(expedienteStage({ requestStatus: 'orden_generada', quotesCount: 2, po: { status: 'pendiente' } })).toMatchObject({
      stage: 'por_autorizar', step: 'autorizacion', waitingOn: 'autorizador',
    }));

  it('orden rechazada (borrador con motivo) → regresa a cotizando marcada', () =>
    expect(expedienteStage({ requestStatus: 'orden_generada', quotesCount: 2, po: { status: 'borrador', rejectionReason: 'caro' } })).toMatchObject({
      stage: 'cotizando', step: 'cotizaciones', rejected: true,
    }));

  it('autorizada → en taller, paso envío', () =>
    expect(expedienteStage({ requestStatus: 'orden_generada', quotesCount: 1, po: { status: 'autorizada' } })).toMatchObject({
      stage: 'en_taller', step: 'envio',
    }));

  it('enviada → en taller, paso cierre, espera al proveedor', () =>
    expect(expedienteStage({ requestStatus: 'orden_generada', quotesCount: 1, po: { status: 'enviada' } })).toMatchObject({
      stage: 'en_taller', step: 'cierre', waitingOn: 'proveedor',
    }));

  it('completada → terminado', () =>
    expect(expedienteStage({ requestStatus: 'completada', quotesCount: 1, po: { status: 'completada' } })).toMatchObject({
      stage: 'terminado', step: 'terminado', waitingOn: null,
    }));

  it('cancelada (solicitud u orden) → cancelado', () => {
    expect(expedienteStage({ requestStatus: 'cancelada', quotesCount: 0, po: null }).stage).toBe('cancelado');
    expect(expedienteStage({ requestStatus: 'orden_generada', quotesCount: 1, po: { status: 'cancelada' } }).stage).toBe('cancelado');
  });
});
