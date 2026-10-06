import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import {
  isResolvedFedexOutcome,
  resolveRouteDayClosureStatus,
  routeDayOf,
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

  it('CASO 383934486493: el regreso a estación (AR/44) tras el DEX NO borra el desenlace del día', () => {
    // 03/10: OD 15:21Z → DEX03 dirección incorrecta 19:16Z → AR "At local FedEx facility" 20:26Z.
    const route = at('2026-10-03');
    const events = [
      ev('2026-10-03', ShipmentStatusType.EN_RUTA, '15:21'),
      ev('2026-10-03', ShipmentStatusType.DIRECCION_INCORRECTA, '19:16', '03'),
      ev('2026-10-03', ShipmentStatusType.EN_RUTA, '20:26'),
      ev('2026-10-03', ShipmentStatusType.EN_BODEGA, '20:26', '44'),
      ev('2026-10-05', ShipmentStatusType.EN_RUTA, '15:31'), // nueva salida, otro día
    ];
    const picked = selectRouteDayFedexEvent(events, route);
    expect(picked?.status).toBe(ShipmentStatusType.DIRECCION_INCORRECTA);
    expect(picked?.exceptionCode).toBe('03');
    expect(picked?.occurredAt.toISOString()).toBe('2026-10-03T19:16:00.000Z');
  });

  it('entre varios desenlaces del día gana el ÚLTIMO desenlace (DEX y luego entregado)', () => {
    const events = [
      ev('2026-09-10', ShipmentStatusType.CLIENTE_NO_DISPONIBLE, '17:00', '08'),
      ev('2026-09-10', ShipmentStatusType.ENTREGADO, '20:00'),
      ev('2026-09-10', ShipmentStatusType.EN_BODEGA, '21:00', '44'),
    ];
    expect(selectRouteDayFedexEvent(events, routeDay)?.status).toBe(ShipmentStatusType.ENTREGADO);
  });

  it('día sin ningún desenlace → el último evento operativo (no fuerza nada después)', () => {
    const events = [
      ev('2026-09-10', ShipmentStatusType.EN_RUTA, '15:00'),
      ev('2026-09-10', ShipmentStatusType.EN_BODEGA, '20:00', '44'),
    ];
    expect(selectRouteDayFedexEvent(events, routeDay)?.status).toBe(ShipmentStatusType.EN_BODEGA);
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

describe('routeDayOf — día operativo de la ruta', () => {
  it("routeDate DATE ('yyyy-MM-dd' o Date 00:00Z) NO se corre al día anterior", () => {
    expect(routeDayOf('2026-10-03')).toBe('2026-10-03');
    expect(routeDayOf(new Date('2026-10-03T00:00:00.000Z'))).toBe('2026-10-03');
  });
  it('createdAt (instante) se lee en zona Hermosillo', () => {
    expect(routeDayOf(new Date('2026-10-04T05:00:00.000Z'))).toBe('2026-10-03'); // 22:00 local del 03
  });
  it('null → null', () => expect(routeDayOf(null)).toBeNull());
});

describe('resolveRouteDayClosureStatus — estatus del cierre = hasta el último del día de la ruta', () => {
  // Historial REAL de 383934486493 (registro e3e75917, salida 487432718907 del 03/10).
  const history = [
    { status: 'pendiente', timestamp: '2026-10-03T08:04:00Z' },
    { status: 'en_ruta', timestamp: '2026-10-03T15:21:00Z' },
    { status: 'pendiente', timestamp: '2026-10-03T17:31:16Z', exceptionCode: 'INIT' },
    { status: 'en_ruta', timestamp: '2026-10-03T17:32:23Z' }, // salida a ruta
    { status: 'direccion_incorrecta', timestamp: '2026-10-03T19:16:00Z', exceptionCode: '03' },
    { status: 'en_ruta', timestamp: '2026-10-03T20:26:00Z' }, // AR regreso a estación
    { status: 'en_bodega', timestamp: '2026-10-03T20:26:00Z', exceptionCode: '44' },
    { status: 'devuelto_a_fedex', timestamp: '2026-10-05T07:00:00Z' }, // devolución días después
    { status: 'en_ruta', timestamp: '2026-10-05T15:31:00Z' }, // nueva salida
    { status: 'direccion_incorrecta', timestamp: '2026-10-05T18:41:00Z', exceptionCode: '03' },
  ];

  it('CASO 383934486493: cierre del 03/10 = DEX03 del 03/10 (ni en_ruta, ni lo del 05/10)', () => {
    const r = resolveRouteDayClosureStatus(history, '2026-10-03');
    expect(r?.status).toBe(ShipmentStatusType.DIRECCION_INCORRECTA);
    expect(r?.exceptionCode).toBe('03');
    expect(r?.occurredAt.toISOString()).toBe('2026-10-03T19:16:00.000Z');
  });

  it('día sin desenlace → último evento del día (sigue en Otros)', () => {
    const r = resolveRouteDayClosureStatus(history.slice(0, 4), '2026-10-03');
    expect(r?.status).toBe(ShipmentStatusType.EN_RUTA);
  });

  it('sin historial del día → null (se usa el estatus vivo)', () => {
    expect(resolveRouteDayClosureStatus(history, '2026-10-04')).toBeNull();
    expect(resolveRouteDayClosureStatus([], '2026-10-03')).toBeNull();
    expect(resolveRouteDayClosureStatus(undefined, '2026-10-03')).toBeNull();
  });
});
