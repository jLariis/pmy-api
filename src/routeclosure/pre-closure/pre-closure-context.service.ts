import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { LD_QUALIFYING_EXCEPTION_CODES } from 'src/common/ld-codes';
import { herDay, LdState } from 'src/common/ld-rule.util';
import { routeDayOf } from 'src/tracking-sync/closure-stuck-resolver.util';
import { buildLdSignals } from './ld-signals.util';

export interface PreClosurePackageContext {
  id: string;
  isCharge: boolean;
  trackingNumber: string;
  /** Ya tiene ingreso ENTREGADO vivo (solo paquetes; las cargas cobran agrupado). */
  hasDeliveredIncome: boolean;
  noMovement: boolean;
  dueToday: boolean;
  ldState: LdState;
}

export interface PreClosureContext {
  routeDay: string;
  is315: boolean;
  packages: PreClosurePackageContext[];
}

/**
 * Renglones de historial que NO son movimiento del chofer: los pone el sistema al registrar,
 * desembarcar o despachar (el "en ruta" de la salida es del mismo día y no cuenta).
 */
const NON_MOVEMENT_STATUSES = new Set<string>([
  ShipmentStatusType.EN_RUTA,
  ShipmentStatusType.EN_TRANSITO,
  ShipmentStatusType.PENDIENTE,
  ShipmentStatusType.RECIBIDO_EN_BODEGA,
  ShipmentStatusType.EN_BODEGA,
  ShipmentStatusType.DESCONOCIDO,
]);
const LD_CODES = new Set<string>(LD_QUALIFYING_EXCEPTION_CODES);

interface DispatchRow { id: string; routeDate: Date | string | null; createdAt: Date | string; is315: number | boolean }
interface PackageRow { id: string; isCharge: number | boolean; trackingNumber: string; status: string; commitDateTime: Date | string | null }
interface StatusRow { shipmentId: string | null; chargeShipmentId: string | null; status: string; exceptionCode: string | null; timestamp: Date | string }

const key = (isCharge: boolean, id: string) => `${isCharge ? 'c' : 's'}:${id}`;

/** Arma el contexto (lógica pura): señales de LD e ingreso entregado por guía. */
export function assemblePreClosureContext(i: {
  dispatch: DispatchRow;
  packages: PackageRow[];
  statusRows: StatusRow[];
  deliveredIncomeShipmentIds: Set<string>;
  /**
   * Estatus con el que el cierre ve cada guía (el del DÍA DE LA RUTA, llave "s:<id>"/"c:<id>").
   * El LD se mide con ese, no con el vivo: una guía sin resultado el día de la ruta que FedEx
   * entregó después sigue en riesgo para el pre-cierre de ese día.
   */
  closureStatuses?: Map<string, string>;
}): PreClosureContext {
  const routeDay = routeDayOf(i.dispatch.routeDate ? new Date(i.dispatch.routeDate) : new Date(i.dispatch.createdAt))!;

  const eventDays = new Map<string, Set<string>>();
  const dexDays = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, day: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(day);
  for (const r of i.statusRows) {
    const k = r.chargeShipmentId ? key(true, r.chargeShipmentId) : key(false, String(r.shipmentId));
    const day = herDay(r.timestamp);
    const code = String(r.exceptionCode ?? '');
    if (!NON_MOVEMENT_STATUSES.has(String(r.status)) || code) add(eventDays, k, day);
    if (LD_CODES.has(code)) add(dexDays, k, day);
  }

  return {
    routeDay,
    is315: !!Number(i.dispatch.is315),
    packages: i.packages.map((p) => {
      const isCharge = !!Number(p.isCharge);
      const k = key(isCharge, p.id);
      const signals = buildLdSignals({
        status: i.closureStatuses?.get(k) ?? p.status,
        commitDateTime: p.commitDateTime,
        routeDay,
        eventDays: eventDays.get(k) ?? new Set(),
        dexDays: dexDays.get(k) ?? new Set(),
      });
      return {
        id: p.id,
        isCharge,
        trackingNumber: p.trackingNumber,
        hasDeliveredIncome: !isCharge && i.deliveredIncomeShipmentIds.has(p.id),
        ...signals,
      };
    }),
  };
}

/**
 * Contexto de la pantalla de cierre con pre-cierre: por guía de la salida (desde el historial de
 * la salida, igual que el cierre) si ya tiene ingreso entregado y sus señales de riesgo de LD.
 * Solo lectura.
 */
@Injectable()
export class PreClosureContextService {
  constructor(private readonly dataSource: DataSource) {}

  async getContext(dispatchId: string, closureStatuses?: { id: string; isCharge: boolean; status: string }[]): Promise<PreClosureContext> {
    const overrides = new Map((closureStatuses ?? []).filter((c) => c?.id && c?.status).map((c) => [key(!!c.isCharge, c.id), String(c.status)]));
    const [dispatch] = await this.dataSource.query(
      `SELECT id, routeDate, createdAt, is315 FROM package_dispatch WHERE id = ?`,
      [dispatchId],
    );
    if (!dispatch) throw new NotFoundException('No se encontró la salida a ruta.');

    const packages: PackageRow[] = await this.dataSource.query(
      `SELECT DISTINCT COALESCE(s.id, c.id) AS id, (c.id IS NOT NULL) AS isCharge,
              COALESCE(s.trackingNumber, c.trackingNumber) AS trackingNumber,
              COALESCE(s.status, c.status) AS status,
              COALESCE(s.commitDateTime, c.commitDateTime) AS commitDateTime
         FROM package_dispatch_history pdh
         LEFT JOIN shipment s ON s.id = pdh.shipmentId
         LEFT JOIN charge_shipment c ON c.id = pdh.chargeShipmentId
        WHERE pdh.dispatchId = ? AND (s.id IS NOT NULL OR c.id IS NOT NULL)`,
      [dispatchId],
    );
    if (packages.length === 0) {
      return assemblePreClosureContext({ dispatch, packages, statusRows: [], deliveredIncomeShipmentIds: new Set(), closureStatuses: overrides });
    }

    const shipmentIds = packages.filter((p) => !Number(p.isCharge)).map((p) => p.id);
    const chargeIds = packages.filter((p) => Number(p.isCharge)).map((p) => p.id);
    const statusRows: StatusRow[] = [];
    const delivered = new Set<string>();

    for (const part of chunk(shipmentIds, 800)) {
      const ph = part.map(() => '?').join(',');
      statusRows.push(
        ...(await this.dataSource.query(
          `SELECT shipmentId, NULL AS chargeShipmentId, status, exceptionCode, timestamp FROM shipment_status WHERE shipmentId IN (${ph})`,
          part,
        )),
      );
      // Mismo criterio que shipmentIncomeWhere: vivos del shipment o de la guía sin shipment ligado.
      const rows: { id: string }[] = await this.dataSource.query(
        `SELECT DISTINCT s.id FROM shipment s
           JOIN income i ON i.active = 1 AND i.incomeType = 'entregado' AND i.sourceType = 'shipment'
                        AND (i.shipmentId = s.id OR (i.shipmentId IS NULL AND i.trackingNumber = s.trackingNumber))
          WHERE s.id IN (${ph})`,
        part,
      );
      rows.forEach((r) => delivered.add(String(r.id)));
    }
    for (const part of chunk(chargeIds, 800)) {
      const ph = part.map(() => '?').join(',');
      statusRows.push(
        ...(await this.dataSource.query(
          `SELECT NULL AS shipmentId, chargeShipmentId, status, exceptionCode, timestamp FROM shipment_status WHERE chargeShipmentId IN (${ph})`,
          part,
        )),
      );
    }

    return assemblePreClosureContext({ dispatch, packages, statusRows, deliveredIncomeShipmentIds: delivered, closureStatuses: overrides });
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
