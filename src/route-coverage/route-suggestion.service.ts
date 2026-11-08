import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Route } from '../entities/route.entity';
import { RouteZipCoverage } from '../entities/route-zip-coverage.entity';
import { StatusEnum } from '../common/enums/status.enum';
import {
  buildSuggestions,
  CoverageForZip,
  LOCAL_OFFSET_MIN,
  SUGGESTION_STATUSES,
  SuggestionPackage,
  SuggestionsResult,
} from './route-suggestion.util';

/** Solo se miran guías recientes: un "pendiente" de hace meses ya no es de salida de hoy. */
const WINDOW_DAYS = Number(process.env.ROUTE_SUGGESTION_DAYS ?? 30);

/**
 * Sugerencias de salida a ruta del día: paquetes que siguen en bodega, agrupados por la
 * ruta que atiende su CP (route_zip_coverage) y ordenados por vencimiento. Solo lectura.
 */
@Injectable()
export class RouteSuggestionService {
  constructor(
    @InjectRepository(Route) private readonly routes: Repository<Route>,
    @InjectRepository(RouteZipCoverage) private readonly coverage: Repository<RouteZipCoverage>,
    private readonly ds: DataSource,
  ) {}

  async forSubsidiary(subsidiaryId: string, now = new Date()): Promise<SuggestionsResult> {
    if (!subsidiaryId) throw new BadRequestException('Elige la sucursal');
    const statuses = SUGGESTION_STATUSES as readonly string[];
    const inList = statuses.map(() => '?').join(',');
    // Día local de hoy (UTC-7) para "salida abierta hoy".
    const today = new Date(now.getTime() + LOCAL_OFFSET_MIN * 60_000).toISOString().slice(0, 10);

    const [routes, coverageRows, shipments, charges, dispatchRows] = await Promise.all([
      this.routes.find({ where: { subsidiary: { id: subsidiaryId }, status: StatusEnum.ACTIVE }, select: { id: true, name: true } }),
      this.coverage.find({ where: { subsidiaryId }, select: { routeId: true, zip: true, share: true, status: true } }),
      // Todos los registros recientes de la sucursal en esas piezas (para quedarnos con el más nuevo
      // por pieza, aunque el más nuevo ya no esté en bodega).
      this.ds.query(
        `SELECT s.id, s.trackingNumber, s.dhlUniqueId, s.recipientZip AS zip, s.recipientName, s.recipientAddress,
                s.commitDateTime, s.status, s.shipmentType, s.createdAt
         FROM shipment s
         WHERE s.subsidiaryId = ? AND s.active = 1 AND s.createdAt >= DATE_SUB(?, INTERVAL ? DAY)
           AND COALESCE(NULLIF(s.dhlUniqueId, ''), s.trackingNumber) IN (
             SELECT COALESCE(NULLIF(x.dhlUniqueId, ''), x.trackingNumber) FROM shipment x
             WHERE x.subsidiaryId = ? AND x.active = 1 AND x.status IN (${inList})
               AND x.createdAt >= DATE_SUB(?, INTERVAL ? DAY))`,
        [subsidiaryId, now, WINDOW_DAYS, subsidiaryId, ...statuses, now, WINDOW_DAYS],
      ),
      this.ds.query(
        `SELECT cs.id, cs.trackingNumber, cs.recipientZip AS zip, cs.recipientName, cs.recipientAddress,
                cs.commitDateTime, cs.status, cs.createdAt
         FROM charge_shipment cs
         LEFT JOIN charge ch ON ch.id = cs.chargeId
         WHERE COALESCE(cs.subsidiaryId, ch.subsidiaryId) = ? AND cs.active = 1
           AND cs.createdAt >= DATE_SUB(?, INTERVAL ? DAY)
           AND cs.trackingNumber IN (
             SELECT y.trackingNumber FROM charge_shipment y LEFT JOIN charge c2 ON c2.id = y.chargeId
             WHERE COALESCE(y.subsidiaryId, c2.subsidiaryId) = ? AND y.active = 1 AND y.status IN (${inList})
               AND y.createdAt >= DATE_SUB(?, INTERVAL ? DAY))`,
        [subsidiaryId, now, WINDOW_DAYS, subsidiaryId, ...statuses, now, WINDOW_DAYS],
      ),
      this.ds.query(
        `SELECT pdr.routeId, MAX(pd.createdAt) AS lastDispatchAt,
                SUM(pd.status IN ('Pendiente', 'En progreso') AND pd.routeDate = ?) AS openToday
         FROM package_dispatch_routes pdr
         JOIN package_dispatch pd ON pd.id = pdr.dispatchId
         WHERE pd.subsidiaryId = ? AND pd.createdAt >= DATE_SUB(?, INTERVAL 60 DAY)
         GROUP BY pdr.routeId`,
        [today, subsidiaryId, now],
      ),
    ]);

    const coverage = new Map<string, CoverageForZip[]>();
    for (const c of coverageRows) {
      coverage.set(c.zip, [...(coverage.get(c.zip) ?? []), { routeId: c.routeId, share: Number(c.share), status: c.status }]);
    }

    const toDate = (v: any): Date | null => (v ? new Date(v) : null);
    const packages: SuggestionPackage[] = [
      ...shipments.map((s: any) => ({
        id: s.id,
        kind: 'shipment' as const,
        trackingNumber: s.trackingNumber,
        pieceKey: `s:${s.dhlUniqueId || s.trackingNumber}`,
        zip: s.zip,
        recipientName: s.recipientName ?? null,
        recipientAddress: s.recipientAddress ?? null,
        commitDateTime: toDate(s.commitDateTime),
        status: String(s.status),
        carrier: String(s.shipmentType).toLowerCase() === 'dhl' ? ('dhl' as const) : ('fedex' as const),
        createdAt: new Date(s.createdAt),
      })),
      ...charges.map((c: any) => ({
        id: c.id,
        kind: 'charge' as const,
        trackingNumber: c.trackingNumber,
        pieceKey: `c:${c.trackingNumber}`,
        zip: c.zip,
        recipientName: c.recipientName ?? null,
        recipientAddress: c.recipientAddress ?? null,
        commitDateTime: toDate(c.commitDateTime),
        status: String(c.status),
        carrier: 'fedex' as const,
        createdAt: new Date(c.createdAt),
      })),
    ];

    const dispatchInfo = new Map<string, { lastDispatchAt: Date | null; openToday: number }>(
      dispatchRows.map((d: any) => [d.routeId, { lastDispatchAt: toDate(d.lastDispatchAt), openToday: Number(d.openToday ?? 0) }]),
    );

    return buildSuggestions({ packages, coverage, routes, dispatchInfo, now });
  }
}
