import { canonicalFedexExceptionCode, canonicalFedexExceptionCodeSql } from './fedex-exception-code.util';
import { effectiveChargeCode, isCountableIncome } from './income-rules.util';
import { ShipmentStatusType } from './enums/shipment-status-type.enum';
import { resolveCanonicalStatus } from 'src/fedex-status/fedex-status.mapping';
import { mapFedexStatusToLocalStatus } from 'src/utils/fedex.utils';

describe('canonicalFedexExceptionCode', () => {
  it('08D es el mismo DEX08', () => {
    expect(canonicalFedexExceptionCode('08D')).toBe('08');
    expect(canonicalFedexExceptionCode(' 08d ')).toBe('08');
  });

  it('deja igual los demás códigos', () => {
    expect(canonicalFedexExceptionCode('08')).toBe('08');
    expect(canonicalFedexExceptionCode('07')).toBe('07');
    expect(canonicalFedexExceptionCode('086C')).toBe('086C');
    expect(canonicalFedexExceptionCode(' 03 ')).toBe('03');
  });

  it('respeta vacíos', () => {
    expect(canonicalFedexExceptionCode(null)).toBeNull();
    expect(canonicalFedexExceptionCode(undefined)).toBeUndefined();
    expect(canonicalFedexExceptionCode('')).toBe('');
  });

  it('el estatus de 08D es cliente no disponible (ambos mapeos)', () => {
    expect(resolveCanonicalStatus({ derivedCode: 'DE', exceptionCode: '08D' })).toBe(ShipmentStatusType.CLIENTE_NO_DISPONIBLE);
    expect(mapFedexStatusToLocalStatus('DE', '08D')).toBe(ShipmentStatusType.CLIENTE_NO_DISPONIBLE);
  });

  it('un ingreso 08D lee la regla de cobro del 08', () => {
    const resolver = { isChargeable: (_c: string, code: string) => (code === '08' ? false : undefined) };
    const income = { sourceType: 'shipment', incomeType: 'no_entregado', nonDeliveryStatus: '08D', shipmentType: 'fedex' };
    expect(effectiveChargeCode(income)).toBe('08');
    expect(isCountableIncome(income, { resolver })).toBe(false);
  });

  it('espejo SQL', () => {
    expect(canonicalFedexExceptionCodeSql('i.code')).toBe(
      "(CASE UPPER(TRIM(i.code)) WHEN '08D' THEN '08' ELSE i.code END)",
    );
  });
});
