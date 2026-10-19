import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import {
  ChargeShipment,
  Consolidated,
  Devolution,
  Income,
  PackageDispatch,
  PackageDispatchHistory,
  Shipment,
  User,
} from 'src/entities';
import { Inventory } from 'src/entities/inventory.entity';
import { DispatchStatus } from 'src/common/enums/dispatch-enum';
import { effectiveLocalDay } from 'src/common/income-window.util';
import {
  buildCarrierEvents,
  buildQueryVariants,
  CarrierEvent,
  InternalEvent,
  pieceKey,
  sortInternalEvents,
  userLabel,
} from './package-dossier.util';

type RecordKind = 'shipment' | 'charge';

export interface DossierIncome {
  id: string;
  day: string;
  cost: number;
  incomeType: string | null;
  sourceType: string;
  isGrouped: boolean;
  active: boolean;
  subsidiaryName: string | null;
  /** Ingreso encontrado solo por número de guía (registros viejos sin enlace al envío). */
  linkedByTracking: boolean;
  createdAt: string | null;
}

export interface DossierRecord {
  id: string;
  kind: RecordKind;
  trackingNumber: string;
  dhlUniqueId: string | null;
  pieceKey: string;
  carrier: string;
  status: string;
  priority: string | null;
  isHighValue: boolean;
  active: boolean;
  subsidiary: { id: string; name: string } | null;
  commitDateTime: string | null;
  createdAt: string | null;
  createdBy: string | null;
  receivedByName: string | null;
  recipient: { name: string | null; address: string | null; city: string | null; zip: string | null; phone: string | null };
  consolidated: { id: string; consNumber: string | null; type: string; day: string | null; numberOfPackages: number; createdBy: string | null } | null;
  charge: { id: string; consNumber: string | null; day: string | null; isHalfTon: boolean; numberOfPackages: number; createdBy: string | null } | null;
  unloading: { id: string; folio: string; date: string | null; createdBy: string | null } | null;
  payment: { type: string; amount: number; status: string } | null;
  incomes: DossierIncome[];
  internalEvents: InternalEvent[];
  carrierEvents: CarrierEvent[];
}

export interface PackageDossier {
  query: string;
  /** Cómo se encontró: por guía o por JD de pieza DHL. */
  matchedBy: 'tracking' | 'dhlPiece' | null;
  /** Pieza a abrir primero (la buscada si fue por JD; si no, la del registro más reciente). */
  selectedPieceKey: string | null;
  records: DossierRecord[];
}

const iso = (d?: Date | string | null): string | null => {
  if (!d) return null;
  const parsed = d instanceof Date ? d : new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

/** Campos de solo día guardados a medianoche (00:00Z): se toma su fecha tal cual. */
const dayOnly = (d?: Date | string | null): string | null => iso(d)?.slice(0, 10) ?? null;

const SENTINEL = ['__none__'];
const orSentinel = (ids: string[]) => (ids.length ? ids : SENTINEL);

const CLOSURE_LABELS: Record<string, string> = {
  entregado: 'Entregado',
  no_entregado: 'No entregado',
  rechazado: 'Rechazado',
  devuelto_a_fedex: 'Devuelto',
  en_bodega: 'Regresó a bodega',
  en_ruta: 'Sigue en ruta',
};

const INVENTORY_LABELS: Record<string, string> = {
  initial: 'Inventario inicial',
  dex: 'Inventario DEX',
  final: 'Inventario final',
};

@Injectable()
export class PackageDossierService {
  constructor(private readonly ds: DataSource) {}

  async getDossier(rawQuery: string): Promise<PackageDossier> {
    const variants = buildQueryVariants(rawQuery);
    const empty: PackageDossier = { query: variants[0] ?? '', matchedBy: null, selectedPieceKey: null, records: [] };
    if (!variants.length) return empty;

    const shipments = await this.ds.getRepository(Shipment).find({
      where: [{ trackingNumber: In(variants) }, { dhlUniqueId: In(variants) }],
      withDeleted: true,
      relations: ['payment', 'subsidiary', 'unloading', 'unloading.createdBy', 'packageDispatch', 'statusHistory'],
    });
    const charges = await this.ds.getRepository(ChargeShipment).find({
      where: { trackingNumber: In(variants) },
      withDeleted: true,
      relations: ['payment', 'subsidiary', 'unloading', 'unloading.createdBy', 'packageDispatch', 'statusHistory', 'charge', 'charge.createdBy'],
    });
    if (!shipments.length && !charges.length) return empty;

    const matchedPiece = shipments.find((s) => s.dhlUniqueId && variants.includes(s.dhlUniqueId.toUpperCase()));
    const shipmentIds = shipments.map((s) => s.id);
    const chargeShipmentIds = charges.map((c) => c.id);
    const chargeIds = [...new Set(charges.map((c) => c.charge?.id).filter(Boolean))] as string[];

    const [consolidatedById, dispatchRows, incomes, inventories, devolutions] = await Promise.all([
      this.loadConsolidated([...shipments, ...charges].map((r) => r.consolidatedId).filter(Boolean)),
      this.loadDispatchHistory(shipmentIds, chargeShipmentIds),
      this.loadIncomes(shipmentIds, chargeIds, variants),
      this.loadInventories(shipmentIds, chargeShipmentIds),
      this.loadDevolutions(shipmentIds, chargeShipmentIds, variants),
    ]);

    // Las salidas a ruta que la guía tiene por FK viva pero sin renglón de historial (datos viejos).
    const liveDispatchIds = [...shipments, ...charges].map((r) => r.packageDispatch?.id).filter(Boolean) as string[];
    const missingDispatchIds = liveDispatchIds.filter((id) => !dispatchRows.some((h) => h.dispatch?.id === id));
    const extraDispatches = missingDispatchIds.length
      ? await this.ds.getRepository(PackageDispatch).find({ where: { id: In(missingDispatchIds) }, relations: ['drivers', 'vehicle'] })
      : [];

    const userIds = new Set<string>();
    [...shipments, ...charges].forEach((r) => r.createdById && userIds.add(r.createdById));
    consolidatedById.forEach((c) => c.createdById && userIds.add(c.createdById));
    devolutions.forEach((d) => d.createdById && userIds.add(d.createdById));
    dispatchRows.forEach((h) => h.dispatch?.createdById && userIds.add(h.dispatch.createdById));
    extraDispatches.forEach((d) => d.createdById && userIds.add(d.createdById));
    const users = userIds.size ? await this.ds.getRepository(User).find({ where: { id: In([...userIds]) } }) : [];
    const userName = (id?: string | null) => userLabel(users.find((u) => u.id === id));

    // Ingresos sin shipmentId (viejos): se cuelgan del registro de paquete más reciente con esa guía.
    const newestShipmentByTracking = new Map<string, Shipment>();
    [...shipments]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .forEach((s) => !newestShipmentByTracking.has(s.trackingNumber) && newestShipmentByTracking.set(s.trackingNumber, s));

    const build = (r: Shipment | ChargeShipment, kind: RecordKind): DossierRecord => {
      const isCharge = kind === 'charge';
      const charge = isCharge ? (r as ChargeShipment).charge : null;
      const cons = r.consolidatedId ? consolidatedById.get(r.consolidatedId) : undefined;

      const recIncomes: DossierIncome[] = incomes
        .filter((i) =>
          isCharge
            ? !!charge && i.charge?.id === charge.id
            : i.shipmentId === r.id || (!i.shipmentId && i.trackingNumber && newestShipmentByTracking.get(i.trackingNumber)?.id === r.id),
        )
        .map((i) => ({
          id: i.id,
          day: effectiveLocalDay(i),
          cost: Number(i.cost) || 0,
          incomeType: i.incomeType ?? null,
          sourceType: i.sourceType,
          isGrouped: !!i.isGrouped,
          active: i.active !== false,
          subsidiaryName: i.subsidiary?.name ?? null,
          linkedByTracking: !isCharge && !i.shipmentId,
          createdAt: iso(i.createdAt),
        }));

      const events: InternalEvent[] = [];
      events.push({
        kind: 'registro',
        date: iso(r.createdAt),
        title: 'Registro en el sistema',
        detail: [
          isCharge ? `Carga ${charge?.consNumber ?? ''}`.trim() : cons?.consNumber ? `Consolidado ${cons.consNumber}` : null,
          userName(r.createdById),
        ].filter(Boolean).join(' · ') || null,
        tag: r.active === false ? 'Dado de baja' : null,
        tone: r.active === false ? 'danger' : 'neutral',
      });

      if (r.unloading) {
        events.push({
          kind: 'desembarque',
          date: iso(r.unloading.date ?? r.unloading.createdAt),
          title: 'Desembarque',
          detail: [`Folio ${r.unloading.trackingNumber}`, userLabel(r.unloading.createdBy)].filter(Boolean).join(' · '),
          tag: null,
          tone: 'neutral',
        });
      }

      const myDispatchRows = dispatchRows.filter((h) => (isCharge ? h.chargeShipment?.id === r.id : h.shipment?.id === r.id));
      const dispatchEvents = [
        ...myDispatchRows.map((h) => ({ d: h.dispatch, h })),
        ...extraDispatches.filter((d) => r.packageDispatch?.id === d.id).map((d) => ({ d, h: null as PackageDispatchHistory | null })),
      ];
      for (const { d, h } of dispatchEvents) {
        if (!d) continue;
        const driver = d.drivers?.map((x) => x.name).filter(Boolean).join(', ');
        const vehicle = d.vehicle ? d.vehicle.name || d.vehicle.code || d.vehicle.plateNumber : null;
        const isLive = r.packageDispatch?.id === d.id;
        let tag: string | null = null;
        let tone: InternalEvent['tone'] = 'info';
        if (h?.closureStatus) {
          tag = `Cierre: ${CLOSURE_LABELS[h.closureStatus] ?? h.closureStatus.replace(/_/g, ' ')}${h.closureExceptionCode ? ` (${/^\d+$/.test(h.closureExceptionCode) ? 'DEX' : ''}${h.closureExceptionCode})` : ''}`;
          tone = h.closureStatus === 'entregado' ? 'success' : 'warning';
        } else if (d.status === DispatchStatus.COMPLETADA || d.closedAt) {
          tag = 'Ruta cerrada';
          tone = 'neutral';
        } else if (d.status === DispatchStatus.CANCELADA) {
          tag = 'Salida cancelada';
          tone = 'danger';
        } else {
          tag = isLive ? 'En ruta · sin cerrar' : 'Se movió a otra salida';
        }
        if (d.active === false) {
          tag = 'Salida eliminada';
          tone = 'danger';
        }
        events.push({
          kind: 'salida_ruta',
          // d.createdAt (datetime) y no h.addedAt (timestamp): el timestamp se desfasa 7 h
          // cuando el servidor MySQL no está en UTC.
          date: iso(d.createdAt ?? h?.addedAt),
          title: d.is315 ? 'Salida a ruta (31.5)' : 'Salida a ruta',
          detail: [
            `Folio ${d.trackingNumber}`,
            driver || 'Sin chofer',
            vehicle ? `Unidad ${vehicle}` : null,
            d.routeDate ? `Día de ruta ${dayOnly(d.routeDate)}` : null,
          ].filter(Boolean).join(' · '),
          tag,
          tone,
        });
      }

      for (const i of recIncomes) {
        events.push({
          kind: 'ingreso',
          // Evento de día: se ordena al cierre de ese día en Hermosillo (después de la salida
          // a ruta que lo generó); createdAt no sirve porque su hora depende del servidor.
          date: new Date(`${i.day}T23:59:59-07:00`).toISOString(),
          day: i.day,
          title: 'Ingreso',
          detail: [
            `$${i.cost.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            i.incomeType ? i.incomeType.replace(/_/g, ' ') : null,
            i.isGrouped ? 'agrupado por carga' : null,
            i.subsidiaryName,
          ].filter(Boolean).join(' · '),
          tag: i.active ? null : 'Anulado',
          tone: i.active ? 'success' : 'danger',
        });
      }

      for (const inv of inventories.filter((x) => (isCharge ? x.chargeShipments : x.shipments)?.some((s) => s.id === r.id))) {
        events.push({
          kind: 'inventario',
          date: iso(inv.inventoryDate ?? inv.createdAt),
          title: INVENTORY_LABELS[inv.type ?? ''] ?? 'Inventario',
          detail: [`Folio ${inv.trackingNumber}`, inv.subsidiary?.name, userLabel(inv.createdBy)].filter(Boolean).join(' · '),
          tag: null,
          tone: 'neutral',
        });
      }

      const myDevolutions = devolutions.filter((d) =>
        isCharge
          ? d.chargeShipmentId === r.id
          : d.shipmentId === r.id || (!d.shipmentId && !d.chargeShipmentId && d.trackingNumber === r.trackingNumber
              && (!d.consolidatedId || d.consolidatedId === r.consolidatedId)),
      );
      for (const d of myDevolutions) {
        events.push({
          kind: 'devolucion',
          date: iso(d.date ?? d.createdAt),
          title: `Devolución a ${r.shipmentType === 'dhl' ? 'DHL' : 'FedEx'}`,
          detail: [`Motivo ${d.reason}`, d.subsidiary?.name, userName(d.createdById)].filter(Boolean).join(' · '),
          tag: d.undoneAt ? 'Se deshizo' : null,
          tone: d.undoneAt ? 'warning' : 'danger',
        });
      }

      return {
        id: r.id,
        kind,
        trackingNumber: r.trackingNumber,
        dhlUniqueId: isCharge ? null : (r as Shipment).dhlUniqueId ?? null,
        pieceKey: pieceKey({ trackingNumber: r.trackingNumber, dhlUniqueId: isCharge ? null : (r as Shipment).dhlUniqueId }),
        carrier: r.shipmentType,
        status: r.status,
        priority: r.priority ?? null,
        isHighValue: !!r.isHighValue,
        active: r.active !== false,
        subsidiary: r.subsidiary ? { id: r.subsidiary.id, name: r.subsidiary.name } : null,
        commitDateTime: iso(r.commitDateTime),
        createdAt: iso(r.createdAt),
        createdBy: userName(r.createdById),
        receivedByName: r.receivedByName || null,
        recipient: {
          name: r.recipientName || null,
          address: r.recipientAddress || null,
          city: r.recipientCity || null,
          zip: r.recipientZip || null,
          phone: r.recipientPhone || null,
        },
        consolidated: cons
          ? {
              id: cons.id,
              consNumber: cons.consNumber ?? null,
              type: cons.type,
              day: dayOnly(cons.date),
              numberOfPackages: cons.numberOfPackages ?? 0,
              createdBy: userName(cons.createdById),
            }
          : null,
        charge: charge
          ? {
              id: charge.id,
              consNumber: charge.consNumber ?? null,
              day: dayOnly(charge.chargeDate),
              isHalfTon: !!charge.isHalfTon,
              numberOfPackages: charge.numberOfPackages ?? 0,
              createdBy: userLabel(charge.createdBy),
            }
          : null,
        unloading: r.unloading
          ? { id: r.unloading.id, folio: r.unloading.trackingNumber, date: iso(r.unloading.date ?? r.unloading.createdAt), createdBy: userLabel(r.unloading.createdBy) }
          : null,
        payment: r.payment ? { type: r.payment.type, amount: Number(r.payment.amount) || 0, status: r.payment.status } : null,
        incomes: recIncomes,
        internalEvents: sortInternalEvents(events),
        carrierEvents: buildCarrierEvents(r.statusHistory ?? []),
      };
    };

    const records = [...shipments.map((s) => build(s, 'shipment')), ...charges.map((c) => build(c, 'charge'))].sort(
      (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
    );

    return {
      query: variants[0],
      matchedBy: matchedPiece ? 'dhlPiece' : 'tracking',
      selectedPieceKey: matchedPiece ? pieceKey(matchedPiece) : records[0]?.pieceKey ?? null,
      records,
    };
  }

  private async loadConsolidated(ids: string[]): Promise<Map<string, Consolidated>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.ds.getRepository(Consolidated).find({ where: { id: In(unique) } });
    return new Map(rows.map((c) => [c.id, c]));
  }

  private loadDispatchHistory(shipmentIds: string[], chargeShipmentIds: string[]): Promise<PackageDispatchHistory[]> {
    return this.ds
      .getRepository(PackageDispatchHistory)
      .createQueryBuilder('h')
      .withDeleted()
      .leftJoinAndSelect('h.dispatch', 'd')
      .leftJoinAndSelect('d.drivers', 'dr')
      .leftJoinAndSelect('d.vehicle', 'v')
      .leftJoin('h.shipment', 's')
      .leftJoin('h.chargeShipment', 'cs')
      .addSelect(['s.id', 'cs.id'])
      .where('s.id IN (:...sids) OR cs.id IN (:...cids)', { sids: orSentinel(shipmentIds), cids: orSentinel(chargeShipmentIds) })
      .getMany();
  }

  private loadIncomes(shipmentIds: string[], chargeIds: string[], variants: string[]): Promise<Income[]> {
    return this.ds
      .getRepository(Income)
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.subsidiary', 'sub')
      .leftJoin('i.charge', 'c')
      .addSelect('c.id')
      .where('i.shipmentId IN (:...sids)', { sids: orSentinel(shipmentIds) })
      .orWhere('i.chargeId IN (:...cids)', { cids: orSentinel(chargeIds) })
      .orWhere('(i.shipmentId IS NULL AND i.sourceType = :st AND i.trackingNumber IN (:...tns))', { st: 'shipment', tns: variants })
      .getMany();
  }

  private loadInventories(shipmentIds: string[], chargeShipmentIds: string[]): Promise<Inventory[]> {
    return this.ds
      .getRepository(Inventory)
      .createQueryBuilder('inv')
      .withDeleted()
      .leftJoinAndSelect('inv.subsidiary', 'sub')
      .leftJoinAndSelect('inv.createdBy', 'u')
      .leftJoin('inv.shipments', 's', 's.id IN (:...sids)', { sids: orSentinel(shipmentIds) })
      .leftJoin('inv.chargeShipments', 'cs', 'cs.id IN (:...cids)', { cids: orSentinel(chargeShipmentIds) })
      .addSelect(['s.id', 'cs.id'])
      .where('s.id IS NOT NULL OR cs.id IS NOT NULL')
      .getMany();
  }

  private loadDevolutions(shipmentIds: string[], chargeShipmentIds: string[], variants: string[]): Promise<Devolution[]> {
    return this.ds
      .getRepository(Devolution)
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.subsidiary', 'sub')
      .where('d.shipmentId IN (:...sids)', { sids: orSentinel(shipmentIds) })
      .orWhere('d.chargeShipmentId IN (:...cids)', { cids: orSentinel(chargeShipmentIds) })
      .orWhere('d.trackingNumber IN (:...tns)', { tns: variants })
      .getMany();
  }
}
