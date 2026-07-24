import {
  DELIVERED_CODE,
  ChargeableResolver,
  effectiveChargeCode,
  isCountableIncome,
} from './income-rules.util';

/** Resolver de prueba a partir de un mapa `${carrier}|${code}` → boolean. */
function resolver(map: Record<string, boolean>): ChargeableResolver {
  return {
    isChargeable: (carrier, code) => {
      const k = `${carrier.toLowerCase()}|${code}`;
      return k in map ? map[k] : undefined;
    },
  };
}

// Reglas globales sembradas por la migración (comportamiento histórico).
const GLOBAL = resolver({
  'fedex|DELIVERED': true,
  'fedex|03': false,
  'fedex|07': true,
  'fedex|08': true,
  'dhl|DELIVERED': true,
  'dhl|NH': false,
  'dhl|BA': false,
  'dhl|RD': false,
  'dhl|CM': false,
});

describe('effectiveChargeCode', () => {
  it('entregado → DELIVERED', () => {
    expect(effectiveChargeCode({ incomeType: 'entregado' })).toBe(DELIVERED_CODE);
  });
  it('no entregado → su código', () => {
    expect(effectiveChargeCode({ incomeType: 'no_entregado', nonDeliveryStatus: '07' })).toBe('07');
  });
});

describe('isCountableIncome (traslados / recolecciones)', () => {
  it('traslados cuentan según countTransfers', () => {
    const inc = { sourceType: 'tyco' };
    expect(isCountableIncome(inc, { countTransfers: true })).toBe(true);
    expect(isCountableIncome(inc, { countTransfers: false })).toBe(false);
  });
  it('traslados: default cuenta', () => {
    expect(isCountableIncome({ sourceType: 'aeropuerto' })).toBe(true);
  });
  it('recolecciones siempre cuentan', () => {
    expect(isCountableIncome({ sourceType: 'collection' }, { countTransfers: false })).toBe(true);
  });
  it('manual/otros no cuentan', () => {
    expect(isCountableIncome({ sourceType: 'manual' })).toBe(false);
  });
});

describe('isCountableIncome (envíos FedEx, reglas globales)', () => {
  const opts = { resolver: GLOBAL };
  it('entregado cuenta', () => {
    expect(isCountableIncome({ sourceType: 'shipment', shipmentType: 'fedex', incomeType: 'entregado' }, opts)).toBe(true);
  });
  it('DEX03 NO cuenta (default)', () => {
    expect(isCountableIncome({ sourceType: 'shipment', shipmentType: 'fedex', incomeType: 'no_entregado', nonDeliveryStatus: '03' }, opts)).toBe(false);
  });
  it('DEX07 y DEX08 cuentan', () => {
    expect(isCountableIncome({ sourceType: 'shipment', shipmentType: 'fedex', incomeType: 'no_entregado', nonDeliveryStatus: '07' }, opts)).toBe(true);
    expect(isCountableIncome({ sourceType: 'charge', shipmentType: 'fedex', incomeType: 'no_entregado', nonDeliveryStatus: '08' }, opts)).toBe(true);
  });
  it('código desconocido → fallback cuenta', () => {
    expect(isCountableIncome({ sourceType: 'shipment', shipmentType: 'fedex', incomeType: 'no_entregado', nonDeliveryStatus: '99' }, opts)).toBe(true);
  });
  it('sin resolver → todo shipment cuenta (fallback histórico)', () => {
    expect(isCountableIncome({ sourceType: 'shipment', shipmentType: 'fedex', incomeType: 'no_entregado', nonDeliveryStatus: '03' })).toBe(true);
  });
});

describe('isCountableIncome (envíos DHL, reglas globales)', () => {
  const opts = { resolver: GLOBAL };
  it('DHL entregado (OK) cuenta', () => {
    expect(isCountableIncome({ sourceType: 'shipment', shipmentType: 'dhl', incomeType: 'entregado' }, opts)).toBe(true);
  });
  it('DHL no entregado (RD/NH/BA/CM) NO cuenta', () => {
    for (const code of ['RD', 'NH', 'BA', 'CM']) {
      expect(isCountableIncome({ sourceType: 'shipment', shipmentType: 'dhl', incomeType: 'no_entregado', nonDeliveryStatus: code }, opts)).toBe(false);
    }
  });
});

describe('isCountableIncome (override de sucursal gana sobre global)', () => {
  it('sucursal que SÍ cobra DEX03', () => {
    const sub = resolver({ 'fedex|03': true });
    const merged: ChargeableResolver = {
      isChargeable: (c, code) => {
        const s = sub.isChargeable(c, code);
        return s !== undefined ? s : GLOBAL.isChargeable(c, code);
      },
    };
    expect(isCountableIncome({ sourceType: 'shipment', shipmentType: 'fedex', incomeType: 'no_entregado', nonDeliveryStatus: '03' }, { resolver: merged })).toBe(true);
  });
});
