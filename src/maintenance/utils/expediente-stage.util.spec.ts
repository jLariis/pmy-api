import { expedienteStage } from './expediente-stage.util';

const run = (requestStatus: string, quotesCount: number, orders: Array<{ status: string; rejectionReason?: string | null }> = []) =>
  expedienteStage({ requestStatus, quotesCount, orders });

describe('expedienteStage (v3: revisión + varias órdenes)', () => {
  it('por revisar → espera a compras', () =>
    expect(run('por_revisar', 0)).toMatchObject({ stage: 'por_revisar', step: 'revision', waitingOn: 'compras' }));

  it('rechazada', () => expect(run('rechazada', 0)).toMatchObject({ stage: 'rechazada', step: 'terminado', waitingOn: null }));

  it('autorizada sin cotizaciones → cotizando, compras captura', () =>
    expect(run('abierta', 0)).toMatchObject({ stage: 'cotizando', step: 'cotizaciones', waitingOn: 'compras' }));

  it('con 2 cotizaciones → comparar por partida', () => expect(run('en_cotizacion', 2).nextStep).toMatch(/partida/i));

  it('alguna orden pendiente → por autorizar (espera a Edgardo)', () =>
    expect(run('orden_generada', 2, [{ status: 'pendiente' }, { status: 'autorizada' }])).toMatchObject({
      stage: 'por_autorizar', step: 'ordenes', waitingOn: 'autorizador',
    }));

  it('orden rechazada (borrador con motivo) → marcada, regresa a compras', () =>
    expect(run('orden_generada', 2, [{ status: 'borrador', rejectionReason: 'caro' }])).toMatchObject({
      stage: 'cotizando', step: 'ordenes', rejected: true, waitingOn: 'compras',
    }));

  it('órdenes autorizadas sin enviar → en proceso, enviar', () =>
    expect(run('orden_generada', 1, [{ status: 'autorizada' }, { status: 'enviada' }])).toMatchObject({
      stage: 'en_proceso', step: 'ordenes', waitingOn: 'compras',
    }));

  it('todas enviadas → en proceso, cierre, espera al proveedor', () =>
    expect(run('orden_generada', 1, [{ status: 'enviada' }, { status: 'completada' }])).toMatchObject({
      stage: 'en_proceso', step: 'cierre', waitingOn: 'proveedor',
    }));

  it('todas completadas (o canceladas con ≥1 completada) → terminado', () => {
    expect(run('orden_generada', 1, [{ status: 'completada' }, { status: 'cancelada' }]).stage).toBe('terminado');
    expect(run('completada', 1, [{ status: 'completada' }]).stage).toBe('terminado');
  });

  it('todas las órdenes canceladas → vuelve a cotizando', () =>
    expect(run('orden_generada', 2, [{ status: 'cancelada' }]).stage).toBe('cotizando'));

  it('solicitud cancelada', () => expect(run('cancelada', 0).stage).toBe('cancelado'));
});
