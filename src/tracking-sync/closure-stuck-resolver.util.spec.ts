import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import {
  isResolvedFedexOutcome,
  selectRouteDayFedexEvent,
  shouldForceFedexAtClosure,
  RouteDayFedexEvent,
  StuckResolveInput,
} from './closure-stuck-resolver.util';

// Hermosillo = UTC-7 fijo. Un instante a las 19:00Z cae ~12:00 local del mismo día calendario.
const at = (isoLocalDay: string, hhmmZ = '19:00') => new Date(`${isoLocalDay}T${hhmmZ}:00.000Z`);
const ev = (day: string, status: ShipmentStatusType, hhmmZ?: string, code: string | null = null): RouteDayFedexEvent => ({
  status, occurredAt: at(day, hhmmZ), exceptionCode: code,
});

describe('isResolvedFedexOutcome', () => {
  it('operativos e indefinido NO son desenlace', () => {
    for (const s of [
      ShipmentStatusType.PENDIENTE, ShipmentStatusType.EN_RUTA, ShipmentStatusType.EN_BODEGA,
      ShipmentStatusType.EN_TRANSITO, ShipmentStatusType.DESCONOCIDO,
    ]) expect(isResolvedFedexOutcome(s)).toBe(false);
    expect(isResolvedFedexOutcome(null)).toBe(false);
  });

  it('rechazado / cliente_no_disponible / entregado / devuelto SÍ son desenlace', () => {
    for (const s of [
      ShipmentStatusType.RECHAZADO, ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
      ShipmentStatusType.ENTREGADO, ShipmentStatusType.DEVUELTO_A_FEDEX,
    ]) expect(isResolvedFedexOutcome(s)).toBe(true);
  });
});

describe('selectRouteDayFedexEvent — estatus DEL DÍA de la ruta', () => {
  const routeDay = at('2026-09-10');

  it('toma el ÚLTIMO evento del día de la ruta', () => {
    const events = [
      ev('2026-09-10', ShipmentStatusType.PENDIENTE, '17:00'),
      ev('2026-09-10', ShipmentStatusType.RECHAZADO, '18:47', '07'),
    ];
    expect(selectRouteDayFedexEvent(events, routeDay)?.status).toBe(ShipmentStatusType.RECHAZADO);
  });

  it('IGNORA eventos de días POSTERIORES (entrega al día siguiente no cuenta)', () => {
    const events = [
      ev('2026-09-10', ShipmentStatusType.RECHAZADO, '18:47', '07'),
      ev('2026-09-11', ShipmentStatusType.ENTREGADO, '16:00'),
    ];
    const picked = selectRouteDayFedexEvent(events, routeDay);
    expect(picked?.status).toBe(ShipmentStatusType.RECHAZADO); // el del día 10, no el entregado del 11
  });

  it('IGNORA eventos de días ANTERIORES (evento pre-ruta)', () => {
    const events = [ev('2026-09-08', ShipmentStatusType.RECHAZADO, '10:00', '07')];
    expect(selectRouteDayFedexEvent(events, routeDay)).toBeNull();
  });

  it('sin eventos del día de la ruta → null (no se toca el EN_RUTA)', () => {
    expect(selectRouteDayFedexEvent([], routeDay)).toBeNull();
    expect(selectRouteDayFedexEvent([ev('2026-09-10', ShipmentStatusType.RECHAZADO)], null)).toBeNull();
  });
});

describe('shouldForceFedexAtClosure', () => {
  const base: StuckResolveInput = {
    currentStatus: ShipmentStatusType.EN_RUTA,
    routeDayStatus: ShipmentStatusType.RECHAZADO,
    persistenceBranch: true,
  };

  it('CASO DEL BUG: desenlace real del día de la ruta + EN_RUTA pegado → fuerza FedEx', () => {
    expect(shouldForceFedexAtClosure(base)).toBe(true);
  });

  it('sucursal NO persistencia → no fuerza', () => {
    expect(shouldForceFedexAtClosure({ ...base, persistenceBranch: false })).toBe(false);
  });

  it('guía que ya NO está EN_RUTA → idempotente, no hace nada', () => {
    expect(shouldForceFedexAtClosure({ ...base, currentStatus: ShipmentStatusType.RECHAZADO })).toBe(false);
  });

  it('el día de la ruta terminó operativo (sin desenlace) → no fuerza', () => {
    expect(shouldForceFedexAtClosure({ ...base, routeDayStatus: ShipmentStatusType.EN_BODEGA })).toBe(false);
    expect(shouldForceFedexAtClosure({ ...base, routeDayStatus: null })).toBe(false);
  });
});
