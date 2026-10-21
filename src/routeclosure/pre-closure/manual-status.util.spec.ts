import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { buildManualReason, manualIncomeEffect, manualOptionToStatus, statusLabel } from './manual-status.util';

describe('manualOptionToStatus', () => {
  it.each([
    ['ENTREGADO', ShipmentStatusType.ENTREGADO, null],
    ['DEX03', ShipmentStatusType.DIRECCION_INCORRECTA, '03'],
    ['DEX07', ShipmentStatusType.RECHAZADO, '07'],
    ['DEX08', ShipmentStatusType.CLIENTE_NO_DISPONIBLE, '08'],
    ['DEX12', ShipmentStatusType.NO_ENTREGADO, '12'],
    ['OCURRE', ShipmentStatusType.ES_OCURRE, null],
  ] as const)('%s → %s / %s', (option, status, exceptionCode) => {
    expect(manualOptionToStatus(option)).toEqual({ status, exceptionCode });
  });
});

describe('statusLabel', () => {
  it.each([
    ['entregado', null, 'Entregado'],
    ['direccion_incorrecta', '03', 'DEX03'],
    ['no_entregado', '12', 'DEX12'],
    ['no_entregado', null, 'No entregado'],
    ['es_ocurre', null, 'Ocurre'],
    ['en_ruta', null, 'En ruta'],
  ])('%s (%s) → %s', (status, code, label) => {
    expect(statusLabel(status, code)).toBe(label);
  });
});

describe('buildManualReason', () => {
  it('arma el motivo automático con usuario, guía, antes/después, ruta y chofer', () => {
    expect(
      buildManualReason({
        userName: 'Ana Ruiz',
        trackingNumber: '878670898264',
        from: 'Entregado',
        to: 'DEX08',
        folio: '929567984667',
        routeDay: '2026-10-20',
        driverNames: 'Samuel Gaytán',
      }),
    ).toBe(
      'Cambio manual en cierre de ruta por Ana Ruiz: guía 878670898264 de Entregado a DEX08. Ruta 929567984667 del 2026-10-20, chofer Samuel Gaytán.',
    );
  });

  it('sin chofer ni folio no deja huecos raros', () => {
    expect(
      buildManualReason({ userName: 'Ana Ruiz', trackingNumber: '1', from: 'En ruta', to: 'Entregado', folio: null, routeDay: '2026-10-20', driverNames: '' }),
    ).toBe('Cambio manual en cierre de ruta por Ana Ruiz: guía 1 de En ruta a Entregado. Ruta sin folio del 2026-10-20, chofer sin chofer.');
  });
});

describe('manualIncomeEffect', () => {
  const base = { isCharge: false, is315: false, hasDeliveredIncome: false };

  it('carga → none (cobra agrupado)', () => {
    expect(manualIncomeEffect({ ...base, isCharge: true, from: 'en_ruta', to: 'entregado' })).toBe('none');
  });

  it('ruta 31.5 → none', () => {
    expect(manualIncomeEffect({ ...base, is315: true, from: 'cliente_no_disponible', to: 'entregado' })).toBe('none');
  });

  it('DEX → entregado → create_delivered', () => {
    expect(manualIncomeEffect({ ...base, from: 'cliente_no_disponible', to: 'entregado' })).toBe('create_delivered');
  });

  it('entregado → DEX con ingreso → annul_delivered', () => {
    expect(manualIncomeEffect({ ...base, hasDeliveredIncome: true, from: 'entregado', to: 'cliente_no_disponible' })).toBe('annul_delivered');
  });

  it('entregado → DEX sin ingreso → none', () => {
    expect(manualIncomeEffect({ ...base, from: 'entregado', to: 'rechazado' })).toBe('none');
  });

  it('DEX → otro DEX → none', () => {
    expect(manualIncomeEffect({ ...base, from: 'rechazado', to: 'direccion_incorrecta' })).toBe('none');
  });
});
