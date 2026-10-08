import { createHash } from 'crypto';
import { formatInTimeZone } from 'date-fns-tz';
import {
  ShipmentStatusType,
  TERMINAL_SHIPMENT_STATUSES,
  isFinalShipmentStatus,
} from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { toHermosilloDateString } from 'src/common/utils';
import { noVanIncomeDecision } from './novan-income.util';
import { reconcileShipmentIncomeAction } from './income-reconcile.util';
import { routeDayOf } from 'src/tracking-sync/closure-stuck-resolver.util';

/**
 * "Paquetes con problema" del cierre de ruta (herramienta de superadmin).
 *
 * Lógica PURA: recibe una foto (FedEx normalizado + historial + ingresos + datos de la salida)
 * y decide qué está mal, qué arreglo se propone y cómo explicarlo en llano. Sin I/O.
 *
 * A diferencia de la reconciliación automática del cierre, NO se ancla al día de la ruta: toma
 * el último desenlace real de FedEx de cualquier día (caso Loreto: entregado el 30-sep, puesto
 * en ruta hasta el 06-oct). El ingreso se fecha con el instante real del evento.
 */

export type DoctorProblemCode =
  | 'STATUS_BEHIND'
  | 'DELIVERED_BEFORE_ROUTE'
  | 'HISTORY_MISSING'
  | 'INCOME_MISSING'
  | 'CLOSURE_STALE'
  | 'WARNING';

export interface DoctorEvent {
  occurredAt: Date;
  status: ShipmentStatusType;
  exceptionCode: string | null;
  description: string | null;
  location: string | null;
  shadowKey: string;
  /** Vetado por las reglas automáticas (p. ej. evento previo al registro). */
  vetoed: boolean;
}

export interface DoctorInput {
  entity: { id: string; trackingNumber: string; kind: 'shipment' | 'charge'; status: ShipmentStatusType };
  /** null = FedEx no regresó datos o hubo error. */
  fedex: null | {
    /** Ascendentes por fecha. */
    events: DoctorEvent[];
    /** Estatus propuesto por el motor con todos sus escudos. */
    shieldedStatus: ShipmentStatusType | null;
    /** Estatus propuesto sin Time Shield ni Escudo Terminal (lo que FedEx realmente dice). */
    rawStatus: ShipmentStatusType | null;
    headerDeliveredAt: Date | null;
  };
  fedexError?: string | null;
  historyRows: { status: ShipmentStatusType; exceptionCode: string | null; timestamp: Date; shadowKey: string }[];
  /** Ingresos SHIPMENT activos de la guía (de cualquier día / ruta). */
  incomes: { id: string; incomeType: IncomeStatus; date: Date }[];
  dispatch: { routeDate: Date | null; createdAt: Date | null; is315: boolean; cost: number };
  /**
   * Cómo la ve HOY el cierre de esta salida (`resolveClosureStatus`) y cuándo volvió a salir en
   * otra ruta (fin de la ventana). Opcional: sin esto no se revisa el estatus del cierre.
   */
  closure?: { status: ShipmentStatusType | null; nextDispatchAt: Date | null };
}

/** Estatus con el que ESTA salida debe cerrar la guía (se guarda en package_dispatch_history). */
export interface DoctorClosurePlan {
  status: ShipmentStatusType;
  /** ISO del instante real del evento que lo respalda. */
  occurredAt: string;
  exceptionCode: string | null;
}

export interface DoctorEventToInsert {
  occurredAt: string;
  status: ShipmentStatusType;
  exceptionCode: string | null;
  description: string | null;
  shadowKey: string;
}

export interface DoctorIncomePlan {
  type: 'create' | 'supersede';
  incomeId?: string;
  incomeType: IncomeStatus;
  nonDeliveryStatus: string | null;
  /** ISO del instante real del evento FedEx. */
  date: string;
  cost: number;
  /** El ingreso cae en una semana (lun–dom) anterior a la de la ruta. */
  pastWeek: boolean;
}

export interface DoctorPlan {
  setStatus: ShipmentStatusType | null;
  insertEvents: DoctorEventToInsert[];
  income: DoctorIncomePlan | null;
  closure?: DoctorClosurePlan | null;
}

export interface PackageDiagnosis {
  shipmentId: string;
  trackingNumber: string;
  kind: 'shipment' | 'charge';
  currentStatus: ShipmentStatusType;
  targetStatus: ShipmentStatusType | null;
  /** Estatus con el que el cierre muestra hoy la guía (null = no se revisó). */
  closureStatus: ShipmentStatusType | null;
  fedexEventAt: string | null;
  problems: DoctorProblemCode[];
  plan: DoctorPlan | null;
  explanation: string[];
  fingerprint: string | null;
}

/** No-entregados que SÍ cobran (espejo de RouteclosureService.CHARGEABLE_NON_DELIVERY). */
const CHARGEABLE_NON_DELIVERY: ShipmentStatusType[] = [
  ShipmentStatusType.RECHAZADO,
  ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
  ShipmentStatusType.DEVUELTO_A_FEDEX,
  ShipmentStatusType.NO_ENTREGADO,
];

/** Desenlaces de un intento de entrega: estos sí pueden saltarse los escudos del motor. */
const OUTCOME_STATUSES = new Set<ShipmentStatusType>([
  ...TERMINAL_SHIPMENT_STATUSES,
  ShipmentStatusType.RECHAZADO,
  ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
  ShipmentStatusType.DIRECCION_INCORRECTA,
  ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
  ShipmentStatusType.NO_ENTREGADO,
]);

export function isOutcomeStatus(s: ShipmentStatusType | null): boolean {
  return !!s && OUTCOME_STATUSES.has(s);
}

const STATUS_LABEL: Partial<Record<ShipmentStatusType, string>> = {
  [ShipmentStatusType.ENTREGADO]: 'entregado',
  [ShipmentStatusType.ENTREGADO_POR_FEDEX]: 'entregado por FedEx',
  [ShipmentStatusType.ENTREGADO_EN_BODEGA]: 'entregado en bodega',
  [ShipmentStatusType.EN_RUTA]: 'en ruta',
  [ShipmentStatusType.EN_BODEGA]: 'en bodega',
  [ShipmentStatusType.PENDIENTE]: 'pendiente',
  [ShipmentStatusType.RECHAZADO]: 'rechazado (DEX07)',
  [ShipmentStatusType.CLIENTE_NO_DISPONIBLE]: 'cliente no disponible (DEX08)',
  [ShipmentStatusType.DIRECCION_INCORRECTA]: 'dirección incorrecta (DEX03)',
  [ShipmentStatusType.CAMBIO_FECHA_SOLICITADO]: 'cambio de fecha (DEX17)',
  [ShipmentStatusType.DEVUELTO_A_FEDEX]: 'devuelto a FedEx',
  [ShipmentStatusType.ES_OCURRE]: 'ocurre',
  [ShipmentStatusType.ACARGO_DE_FEDEX]: 'a cargo de FedEx',
  [ShipmentStatusType.NO_ENTREGADO]: 'no entregado',
};

export function statusLabel(s: ShipmentStatusType | null): string {
  if (!s) return 'sin estatus';
  return STATUS_LABEL[s] ?? String(s).replace(/_/g, ' ');
}

function fmt(d: Date): string {
  const mon = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const day = formatInTimeZone(d, 'America/Hermosillo', 'dd');
  const m = Number(formatInTimeZone(d, 'America/Hermosillo', 'M')) - 1;
  const hm = formatInTimeZone(d, 'America/Hermosillo', 'HH:mm');
  return `${day}-${mon[m]} ${hm}`;
}

function fmtDay(day: string): string {
  const mon = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const [, m, d] = day.split('-');
  return `${d}-${mon[Number(m) - 1]}`;
}

/** Lunes (YYYY-MM-DD) de la semana lun–dom de un día YYYY-MM-DD. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00.000Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const isDelivered = (s: ShipmentStatusType) =>
  s === ShipmentStatusType.ENTREGADO || s === ShipmentStatusType.ENTREGADO_POR_FEDEX;

/** Último evento FedEx que respalda el estatus destino. */
function backingEventFor(events: DoctorEvent[], target: ShipmentStatusType): DoctorEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.status === target) return e;
    if (target === ShipmentStatusType.ENTREGADO && isDelivered(e.status)) return e;
  }
  return null;
}

function toInsert(e: DoctorEvent, status: ShipmentStatusType = e.status): DoctorEventToInsert {
  return {
    occurredAt: e.occurredAt.toISOString(),
    status,
    exceptionCode: e.exceptionCode,
    description: e.description,
    shadowKey: e.shadowKey,
  };
}

export function fingerprintOf(plan: DoctorPlan | null): string | null {
  if (!plan) return null;
  const stable = {
    s: plan.setStatus,
    e: plan.insertEvents.map((e) => `${e.shadowKey}>${e.status}`).sort(),
    i: plan.income
      ? [plan.income.type, plan.income.incomeId ?? '', plan.income.incomeType, plan.income.nonDeliveryStatus ?? '', plan.income.date, plan.income.cost]
      : null,
    c: plan.closure ? [plan.closure.status, plan.closure.occurredAt, plan.closure.exceptionCode ?? ''] : null,
  };
  return createHash('sha1').update(JSON.stringify(stable)).digest('hex');
}

export function diagnosePackage(input: DoctorInput): PackageDiagnosis {
  const { entity, fedex, historyRows, incomes, dispatch } = input;
  const result: PackageDiagnosis = {
    shipmentId: entity.id,
    trackingNumber: entity.trackingNumber,
    kind: entity.kind,
    currentStatus: entity.status,
    targetStatus: null,
    closureStatus: input.closure?.status ?? null,
    fedexEventAt: null,
    problems: [],
    plan: null,
    explanation: [],
    fingerprint: null,
  };
  const warn = (msg: string) => {
    if (!result.problems.includes('WARNING')) result.problems.push('WARNING');
    result.explanation.push(msg);
  };

  if (!fedex) {
    warn(`FedEx no regresó datos de esta guía${input.fedexError ? ` (${input.fedexError})` : ''}. No se puede revisar.`);
    return result;
  }

  const target = isOutcomeStatus(fedex.rawStatus) ? fedex.rawStatus : fedex.shieldedStatus;
  result.targetStatus = target;
  if (!target) {
    warn('FedEx no tiene un estatus claro para esta guía. No se propone ningún cambio.');
    return result;
  }

  const backing = backingEventFor(fedex.events, target);
  const eventAt: Date | null =
    backing?.occurredAt ?? (target === ShipmentStatusType.ENTREGADO ? fedex.headerDeliveredAt : null);
  result.fedexEventAt = eventAt ? eventAt.toISOString() : null;

  const current = entity.status;
  const routeAnchor = dispatch.routeDate ?? dispatch.createdAt;
  // routeDate es DATE (00:00Z flotante): routeDayOf no lo corre al día anterior.
  const routeDay = routeDayOf(routeAnchor);
  const fedexSays = `FedEx reporta ${statusLabel(target).toUpperCase()}${eventAt ? ` el ${fmt(eventAt)}` : ''}.`;

  const plan: DoctorPlan = { setStatus: null, insertEvents: [], income: null, closure: null };

  // Un estatus final nunca se degrada desde aquí. Lo único que sí se ofrece es que el CIERRE de
  // esta salida tome ese estatus final si ocurrió dentro de la ventana de la ruta.
  // Devuelto a FedEx después de un DEX es lo normal (se registra la devolución tras el intento
  // fallido): no es una discrepancia.
  const returnedAfterDex =
    current === ShipmentStatusType.DEVUELTO_A_FEDEX && isOutcomeStatus(target) && !isDelivered(target);
  if (isFinalShipmentStatus(current) && target !== current) {
    if (!returnedAfterDex) {
      warn(
        `${fedexSays} En el sistema la guía está ${statusLabel(current)}, que es un estatus final. ` +
          'No se cambia desde aquí; revísala a mano.',
      );
    }
    const lastFinal = [...historyRows]
      .filter((r) => r.status === current)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
    if (lastFinal) checkClosure(input, result, plan, current, lastFinal.timestamp, lastFinal.exceptionCode, routeDay);
    return finish(result, plan);
  }

  const known = new Set(historyRows.map((r) => r.shadowKey));

  // Entregado (o devuelto) ANTES del día de la ruta (caso Loreto): se marca aunque el estatus
  // ya coincida, para que el superadmin vea que se revisó y si quedó algo pendiente.
  const eventDay = eventAt ? toHermosilloDateString(eventAt) : null;
  const beforeRoute =
    (target === ShipmentStatusType.ENTREGADO || target === ShipmentStatusType.DEVUELTO_A_FEDEX) &&
    !!eventDay && !!routeDay && eventDay < routeDay;
  const beforeRouteLine = () => {
    const n = daysBetween(eventDay!, routeDay!);
    return `La guía se puso en la ruta del ${fmtDay(routeDay!)}, ${n} ${n === 1 ? 'día' : 'días'} después de que FedEx la marcó como ${statusLabel(target)}.`;
  };

  if (target !== current) {
    result.problems.push('STATUS_BEHIND');
    plan.setStatus = target;
    for (const e of fedex.events) {
      if (known.has(e.shadowKey)) continue;
      if (e === backing) plan.insertEvents.push(toInsert(e, target));
      else if (!e.vetoed) plan.insertEvents.push(toInsert(e));
    }
    const lines = [`${fedexSays} En el sistema la guía dice ${statusLabel(current)}.`];
    if (beforeRoute) {
      result.problems.push('DELIVERED_BEFORE_ROUTE');
      lines.push(beforeRouteLine());
    }
    lines.push(
      `Se corrige el estatus a ${statusLabel(target)}` +
        (plan.insertEvents.length
          ? ` y se ${plan.insertEvents.length === 1 ? 'agrega 1 evento' : `agregan ${plan.insertEvents.length} eventos`} de FedEx con su fecha real.`
          : '.'),
    );
    result.explanation.push(...lines);
  } else if (backing && !historyRows.some((r) => r.status === target) && !known.has(backing.shadowKey)) {
    result.problems.push('HISTORY_MISSING');
    plan.insertEvents.push(toInsert(backing, target));
    result.explanation.push(
      `${fedexSays} La guía ya dice ${statusLabel(current)}, pero falta ese evento en su historial. Se agrega el evento de FedEx del ${fmt(backing.occurredAt)}.`,
    );
    if (beforeRoute) {
      result.problems.push('DELIVERED_BEFORE_ROUTE');
      result.explanation.push(beforeRouteLine());
    }
  }

  // ── Ingreso ──
  const hasEntregadoIncome = incomes.some((i) => i.incomeType === IncomeStatus.ENTREGADO);
  if (entity.kind === 'charge') {
    if (result.problems.length) result.explanation.push('Es una carga F2: no genera ingreso.');
  } else if (dispatch.is315) {
    if (result.problems.length) result.explanation.push('Es una ruta 31.5: no genera ingreso.');
  } else {
    if (hasEntregadoIncome && target !== ShipmentStatusType.ENTREGADO) {
      warn(
        `La guía ya está cobrada como entregada, pero FedEx dice ${statusLabel(target)}. ` +
          'No se corrige aquí; revísala en el Consolidador.',
      );
    }
    const delivered = target === ShipmentStatusType.ENTREGADO;
    const chargeableDex = !delivered && CHARGEABLE_NON_DELIVERY.includes(target);
    const dex08Dates = [
      ...historyRows.filter((r) => (r.exceptionCode ?? '').trim() === '08').map((r) => r.timestamp),
      ...plan.insertEvents.filter((e) => (e.exceptionCode ?? '').trim() === '08').map((e) => new Date(e.occurredAt)),
    ];
    const decision = noVanIncomeDecision({
      trackingNumber: entity.trackingNumber,
      delivered,
      dexCode: chargeableDex ? backing?.exceptionCode || null : null,
      resolved: true,
      dex08Dates,
    });
    if (decision && eventAt) {
      const deliveryDay = toHermosilloDateString(eventAt);
      const dexRow = incomes.find((i) => i.incomeType === IncomeStatus.NO_ENTREGADO);
      const action = reconcileShipmentIncomeAction({
        decision,
        deliveryDay,
        existing: {
          entregado: hasEntregadoIncome,
          dex: dexRow ? { id: dexRow.id, day: toHermosilloDateString(dexRow.date) } : undefined,
        },
      });
      if (action.type !== 'none') {
        const pastWeek = !!routeDay && mondayOf(deliveryDay) < mondayOf(routeDay);
        plan.income = {
          type: action.type,
          incomeId: action.type === 'supersede' ? action.incomeId : undefined,
          incomeType: action.type === 'create' ? action.incomeType : IncomeStatus.ENTREGADO,
          nonDeliveryStatus: action.type === 'create' ? action.nonDeliveryStatus : null,
          date: eventAt.toISOString(),
          cost: dispatch.cost,
          pastWeek,
        };
        result.problems.push('INCOME_MISSING');
        const what =
          action.type === 'supersede'
            ? `Se cambia el ingreso de no entregado a entregado ($${dispatch.cost})`
            : `Se crea el ingreso de $${dispatch.cost} (${decision.nonDeliveryStatus ? `DEX${decision.nonDeliveryStatus}` : 'entregado'})`;
        result.explanation.push(
          `${what} con fecha ${fmtDay(deliveryDay)}` +
            (pastWeek ? `; cae en la semana del ${fmtDay(mondayOf(deliveryDay))}, ya pasada.` : '.'),
        );
        if (dispatch.cost <= 0) {
          result.explanation.push('Ojo: la sucursal tiene costo FedEx en $0; el ingreso quedaría en $0.');
        }
      } else if (result.problems.some((p) => p !== 'WARNING') && hasEntregadoIncome && delivered) {
        result.explanation.push('No se crea ingreso porque ya existe uno.');
      }
    }
  }

  if (eventAt) checkClosure(input, result, plan, target, eventAt, backing?.exceptionCode ?? null, routeDay);

  if (beforeRoute && !result.problems.includes('DELIVERED_BEFORE_ROUTE')) {
    if (!result.problems.length) {
      result.explanation.push(`${fedexSays} ${beforeRouteLine()}`, 'Ya tiene estatus, historial e ingreso correctos: no hay nada que corregir.');
    } else {
      result.explanation.push(beforeRouteLine());
    }
    result.problems.push('DELIVERED_BEFORE_ROUTE');
  }

  return finish(result, plan);
}

function finish(result: PackageDiagnosis, plan: DoctorPlan): PackageDiagnosis {
  const hasPlan = !!plan.setStatus || plan.insertEvents.length > 0 || !!plan.income || !!plan.closure;
  if (hasPlan) {
    result.plan = plan;
    result.fingerprint = fingerprintOf(plan);
  }
  return result;
}

/**
 * ¿El cierre de ESTA salida muestra otra cosa que el desenlace real? Pasa cuando FedEx reportó el
 * entregado/DEX después del día de la ruta (p. ej. al día siguiente) en una sucursal sin la opción
 * "hasta la siguiente salida": el cierre la sigue viendo "en ruta". Solo si el evento cae desde el
 * día de la ruta y antes de que la guía saliera en otra ruta. El arreglo se guarda para esta
 * salida; no toca el estatus vivo.
 */
function checkClosure(
  input: DoctorInput,
  result: PackageDiagnosis,
  plan: DoctorPlan,
  status: ShipmentStatusType,
  at: Date,
  exceptionCode: string | null,
  routeDay: string | null,
): void {
  const closure = input.closure;
  if (!closure || !routeDay || !isOutcomeStatus(status)) return;
  if (closure.status === status) return;
  // Solo se rescata lo que el cierre ve SIN desenlace (en ruta, pendiente…). Si ya muestra un
  // DEX del día, ese es el resultado de la ruta: la devolución registrada después no lo cambia.
  if (isOutcomeStatus(closure.status)) return;
  const day = toHermosilloDateString(at);
  if (day < routeDay) return;
  if (closure.nextDispatchAt && at >= closure.nextDispatchAt) return;
  plan.closure = { status, occurredAt: at.toISOString(), exceptionCode: exceptionCode || null };
  result.problems.push('CLOSURE_STALE');
  const n = daysBetween(routeDay, day);
  const when = n === 0 ? 'el mismo día de la ruta' : n === 1 ? 'al día siguiente de la ruta' : `${n} días después de la ruta`;
  result.explanation.push(
    `El cierre la muestra como ${statusLabel(closure.status)}, pero quedó ${statusLabel(status)} el ${fmt(at)} (${when}). ` +
      `Se toma ${statusLabel(status)} para el cierre de esta salida.`,
  );
}
