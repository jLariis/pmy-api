import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { RouteZipCoverage, RouteZipCoverageStatus } from '../entities/route-zip-coverage.entity';
import { Route } from '../entities/route.entity';
import { cleanZip } from '../inbox/zip-coverage.util';
import { StatusEnum } from '../common/enums/status.enum';
import { computeRouteZipShares, RouteZipRow } from './route-zip-coverage.util';

export interface RouteCoverageRow {
  id: string;
  routeId: string;
  zip: string;
  city: string | null;
  shipmentCount: number;
  share: number;
  source: 'historial' | 'manual';
  status: RouteZipCoverageStatus;
  lastSeenAt: Date | null;
  /** Otras rutas (de la misma sucursal) que también atienden este CP. */
  sharedWith: { routeId: string; routeName: string; share: number }[];
}

export interface RouteCoverageSummary {
  routes: { id: string; name: string; zips: number; shipments: number; pending: number }[];
  rows: RouteCoverageRow[];
  /** CPs que atiende la sucursal (cobertura por sucursal) sin ninguna ruta activa. */
  unassigned: { zip: string; city: string | null; shipmentCount: number }[];
}

/**
 * CPs que atiende cada ruta. Se recalcula con el historial de salidas (6 meses por
 * defecto) y nunca pisa el `status` (confirmado/excluido) que alguien puso.
 */
@Injectable()
export class RouteCoverageService {
  private readonly logger = new Logger(RouteCoverageService.name);

  constructor(
    @InjectRepository(RouteZipCoverage) private readonly repo: Repository<RouteZipCoverage>,
    @InjectRepository(Route) private readonly routes: Repository<Route>,
    private readonly ds: DataSource,
  ) {}

  /**
   * Una guía cuenta para la ruta de su salida; si la salida llevó varias rutas, cuenta
   * 1/n para cada una. Solo rutas activas y guías activas (no borradas).
   */
  async rebuildFromHistory(
    subsidiaryId?: string,
    days = Number(process.env.ROUTE_COVERAGE_DAYS ?? 180),
  ): Promise<{ pairs: number; days: number }> {
    const subFilter = subsidiaryId ? 'AND r.subsidiaryId = ?' : '';
    const params: unknown[] = [days, ...(subsidiaryId ? [subsidiaryId] : [])];
    const raw: any[] = await this.ds.query(
      `SELECT r.id AS routeId, r.subsidiaryId AS subsidiaryId,
              COALESCE(s.recipientZip, cs.recipientZip) AS zip,
              UPPER(TRIM(COALESCE(s.recipientCity, cs.recipientCity))) AS city,
              SUM(1 / nr.n) AS weight, MIN(pd.createdAt) AS firstSeen, MAX(pd.createdAt) AS lastSeen
       FROM package_dispatch_history h
       JOIN package_dispatch pd ON pd.id = h.dispatchId
       JOIN (SELECT dispatchId, COUNT(*) AS n FROM package_dispatch_routes GROUP BY dispatchId) nr ON nr.dispatchId = pd.id
       JOIN package_dispatch_routes pdr ON pdr.dispatchId = pd.id
       JOIN route r ON r.id = pdr.routeId AND r.status = 'activo' AND r.subsidiaryId IS NOT NULL
       LEFT JOIN shipment s ON s.id = h.shipmentId AND s.active = 1
       LEFT JOIN charge_shipment cs ON cs.id = h.chargeShipmentId AND cs.active = 1
       WHERE pd.createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) ${subFilter}
         AND (s.id IS NOT NULL OR cs.id IS NOT NULL)
       GROUP BY r.id, r.subsidiaryId, zip, city`,
      params,
    );
    const rows: RouteZipRow[] = raw.map((r) => ({
      routeId: r.routeId,
      subsidiaryId: r.subsidiaryId,
      zip: r.zip,
      city: r.city,
      weight: Number(r.weight),
      firstSeen: r.firstSeen ? new Date(r.firstSeen) : null,
      lastSeen: r.lastSeen ? new Date(r.lastSeen) : null,
    }));
    const shares = computeRouteZipShares(rows);

    // Lo que salió de la ventana deja de contar (sin borrar filas ni tocar su status).
    await this.ds.query(
      `UPDATE route_zip_coverage SET shipmentCount = 0, share = 0 WHERE source = 'historial' ${subsidiaryId ? 'AND subsidiaryId = ?' : ''}`,
      subsidiaryId ? [subsidiaryId] : [],
    );
    for (let i = 0; i < shares.length; i += 500) {
      const chunk = shares.slice(i, i + 500);
      const values = chunk.map(() => `(?, ?, ?, ?, ?, ?, 0, 'historial', 'sugerido', ?, ?)`).join(',');
      const p = chunk.flatMap((s) => [randomUUID(), s.routeId, s.subsidiaryId, s.zip, s.city, s.shipmentCount, s.firstSeenAt, s.lastSeenAt]);
      await this.ds.query(
        `INSERT INTO route_zip_coverage (id, routeId, subsidiaryId, zip, city, shipmentCount, share, source, status, firstSeenAt, lastSeenAt)
         VALUES ${values}
         ON DUPLICATE KEY UPDATE city = COALESCE(VALUES(city), city), shipmentCount = VALUES(shipmentCount),
           firstSeenAt = LEAST(COALESCE(firstSeenAt, VALUES(firstSeenAt)), COALESCE(VALUES(firstSeenAt), firstSeenAt)),
           lastSeenAt = GREATEST(COALESCE(lastSeenAt, VALUES(lastSeenAt)), COALESCE(VALUES(lastSeenAt), lastSeenAt))`,
        p,
      );
    }
    await this.recomputeShares(subsidiaryId);
    this.logger.log(`🗺️ CPs por ruta recalculados (${days} días${subsidiaryId ? `, sucursal ${subsidiaryId}` : ''}): ${shares.length} pares ruta–CP`);
    return { pairs: shares.length, days };
  }

  /**
   * Proporción de cada ruta dentro de su CP (por sucursal), a partir de shipmentCount.
   * Los excluidos no cuentan en el total ni reciben proporción.
   */
  async recomputeShares(subsidiaryId?: string): Promise<void> {
    const where = subsidiaryId ? 'AND subsidiaryId = ?' : '';
    await this.ds.query(
      `UPDATE route_zip_coverage c
       JOIN (SELECT subsidiaryId, zip, SUM(shipmentCount) AS t, COUNT(*) AS k FROM route_zip_coverage
             WHERE status <> 'excluido' ${where} GROUP BY subsidiaryId, zip) s
         ON s.subsidiaryId = c.subsidiaryId AND s.zip = c.zip
       SET c.share = IF(c.status = 'excluido', 0, IF(s.t > 0, c.shipmentCount / s.t, 1 / s.k))`,
      subsidiaryId ? [subsidiaryId] : [],
    );
    // CPs donde todas las rutas quedaron excluidas: proporción en cero.
    await this.ds.query(`UPDATE route_zip_coverage SET share = 0 WHERE status = 'excluido' ${where}`, subsidiaryId ? [subsidiaryId] : []);
  }

  async summary(subsidiaryId: string): Promise<RouteCoverageSummary> {
    if (!subsidiaryId) throw new BadRequestException('Elige la sucursal');
    const routes = await this.routes.find({ where: { subsidiary: { id: subsidiaryId }, status: StatusEnum.ACTIVE }, order: { name: 'ASC' } });
    const routeName = new Map(routes.map((r) => [r.id, r.name]));
    const all = await this.repo.find({ where: { subsidiaryId }, order: { shipmentCount: 'DESC' } });
    const active = all.filter((r) => routeName.has(r.routeId));

    const byZip = new Map<string, RouteZipCoverage[]>();
    for (const r of active) {
      if (r.status === 'excluido') continue;
      byZip.set(r.zip, [...(byZip.get(r.zip) ?? []), r]);
    }

    const rows: RouteCoverageRow[] = active.map((r) => ({
      id: r.id,
      routeId: r.routeId,
      zip: r.zip,
      city: r.city,
      shipmentCount: r.shipmentCount,
      share: Number(r.share),
      source: r.source,
      status: r.status,
      lastSeenAt: r.lastSeenAt,
      sharedWith: (byZip.get(r.zip) ?? [])
        .filter((o) => o.routeId !== r.routeId)
        .map((o) => ({ routeId: o.routeId, routeName: routeName.get(o.routeId) ?? '', share: Number(o.share) })),
    }));

    const summaryRoutes = routes.map((rt) => {
      const mine = active.filter((r) => r.routeId === rt.id && r.status !== 'excluido');
      return {
        id: rt.id,
        name: rt.name,
        zips: mine.length,
        shipments: mine.reduce((a, r) => a + r.shipmentCount, 0),
        pending: mine.filter((r) => r.status === 'sugerido').length,
      };
    });

    const assigned = new Set(byZip.keys());
    const subZips: any[] = await this.ds.query(
      `SELECT zip, city, shipmentCount FROM subsidiary_zip_coverage
       WHERE subsidiaryId = ? AND status <> 'excluido' AND shipmentCount > 0 ORDER BY shipmentCount DESC`,
      [subsidiaryId],
    );
    const unassigned = subZips
      .filter((z) => !assigned.has(z.zip))
      .map((z) => ({ zip: z.zip, city: z.city ?? null, shipmentCount: Number(z.shipmentCount) }));

    return { routes: summaryRoutes, rows, unassigned };
  }

  async setStatus(id: string, status: RouteZipCoverageStatus): Promise<RouteZipCoverage> {
    if (!['sugerido', 'confirmado', 'excluido'].includes(status)) throw new BadRequestException('Estado no válido');
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('No se encontró ese código postal en la ruta');
    row.status = status;
    await this.repo.save(row);
    await this.recomputeShares(row.subsidiaryId);
    return (await this.repo.findOne({ where: { id } }))!;
  }

  async addManual(dto: { zip: string; routeId: string; city?: string | null }): Promise<RouteZipCoverage> {
    const zip = cleanZip(dto?.zip);
    if (!zip) throw new BadRequestException('Escribe un código postal de 5 dígitos');
    if (!dto?.routeId) throw new BadRequestException('Elige la ruta');
    const route = await this.routes.findOne({ where: { id: dto.routeId }, relations: ['subsidiary'] });
    if (!route?.subsidiary?.id) throw new BadRequestException('Esa ruta no tiene sucursal asignada');

    const existing = await this.repo.findOne({ where: { routeId: route.id, zip } });
    if (existing) {
      existing.status = 'confirmado';
      if (dto.city) existing.city = dto.city;
      await this.repo.save(existing);
    } else {
      await this.repo.save(
        this.repo.create({
          routeId: route.id,
          subsidiaryId: route.subsidiary.id,
          zip,
          city: dto.city ?? null,
          shipmentCount: 0,
          share: '0',
          source: 'manual',
          status: 'confirmado',
          firstSeenAt: new Date(),
          lastSeenAt: null,
        }),
      );
    }
    await this.recomputeShares(route.subsidiary.id);
    return (await this.repo.findOne({ where: { routeId: route.id, zip } }))!;
  }
}
