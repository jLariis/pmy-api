import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import {
  isResolvedFedexOutcome,
  shouldForceFedexAtClosure,
  StuckResolveInput,
} from './closure-stuck-resolver.util';

// Hermosillo = UTC-7 fijo. 07:00Z == 00:00 local (inicio del día operativo).
const day = (isoLocalNoon: string) => new Date(`${isoLocalNoon}T19:00:00.000Z`); // ~12:00 local

describe('isResolvedFedexOutcome', () => {
  it('operativos e indefinido NO son desenlace', () => {
    for (const s of [
      ShipmentStatusType.PENDIENTE,
      ShipmentStatusType.EN_RUTA,
      ShipmentStatusType.EN_BODEGA,
      ShipmentStatusType.EN_TRANSITO,
      ShipmentStatusType.DESCONOCIDO,
    ]) {
      expect(isResolvedFedexOutcome(s)).toBe(false);
    }
    expect(isResolvedFedexOutcome(null)).toBe(false);
  });

  it('rechazado / cliente_no_disponible / entregado / devuelto SÍ son desenlace', () => {
    for (const s of [
      ShipmentStatusType.RECHAZADO,
      ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
      ShipmentStatusType.ENTREGADO,
      ShipmentStatusType.DEVUELTO_A_FEDEX,
    ]) {
      expect(isResolvedFedexOutcome(s)).toBe(true);
    }
  });
});

describe('shouldForceFedexAtClosure', () => {
  const base: StuckResolveInput = {
    currentStatus: ShipmentStatusType.EN_RUTA,
    fedexLastStatus: ShipmentStatusType.RECHAZADO,
    fedexLastEventAt: day('2026-09-08'),
    routeAnchor: day('2026-09-08'),
    persistenceBranch: true,
  };

  it('CASO DEL BUG: rechazado el mismo día operativo, cierre abierto días después → fuerza FedEx', () => {
    // El evento (08 sep) es anterior al EN_RUTA de captura tardía, pero es del día operativo.
    expect(shouldForceFedexAtClosure(base)).toBe(true);
  });

  it('evento en día POSTERIOR al de la ruta también se resuelve', () => {
    expect(
      shouldForceFedexAtClosure({ ...base, fedexLastEventAt: day('2026-09-09') }),
    ).toBe(true);
  });

  it('evento ANTERIOR al día de la ruta NO se toca (el escudo protege legítimamente)', () => {
    expect(
      shouldForceFedexAtClosure({ ...base, fedexLastEventAt: day('2026-09-07') }),
    ).toBe(false);
  });

  it('sucursal NO persistencia → no fuerza (respeta el escudo estándar)', () => {
    expect(shouldForceFedexAtClosure({ ...base, persistenceBranch: false })).toBe(false);
  });

  it('guía que ya NO está EN_RUTA → no hace nada (idempotente)', () => {
    expect(
      shouldForceFedexAtClosure({ ...base, currentStatus: ShipmentStatusType.RECHAZADO }),
    ).toBe(false);
  });

  it('FedEx reporta estatus operativo (en_bodega) → no fuerza', () => {
    expect(
      shouldForceFedexAtClosure({ ...base, fedexLastStatus: ShipmentStatusType.EN_BODEGA }),
    ).toBe(false);
  });

  it('sin datos de FedEx (fecha/estatus nulos) → no fuerza', () => {
    expect(shouldForceFedexAtClosure({ ...base, fedexLastStatus: null })).toBe(false);
    expect(shouldForceFedexAtClosure({ ...base, fedexLastEventAt: null })).toBe(false);
    expect(shouldForceFedexAtClosure({ ...base, routeAnchor: null })).toBe(false);
  });
});
