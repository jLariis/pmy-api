import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { SubsidiaryZipCoverage, ZipCoverageStatus } from '../entities/subsidiary-zip-coverage.entity';
import { cleanZip, computeZipShares, ZipCountRow } from './zip-coverage.util';

/**
 * Cobertura de códigos postales por sucursal. Se arma con el historial de
 * shipment + charge_shipment, crece con los correos confirmados y se edita a mano.
 * Nunca pisa el `status` (confirmado/excluido) que alguien puso.
 */
@Injectable()
export class ZipCoverageService {
  private readonly logger = new Logger(ZipCoverageService.name);

  constructor(
    @InjectRepository(SubsidiaryZipCoverage) private readonly repo: Repository<SubsidiaryZipCoverage>,
    private readonly ds: DataSource,
  ) {}

  /**
   * Recalcula desde el historial RECIENTE (ventana de `days`, por defecto 90): la
   * operación cambia (p. ej. los CP de Caborca eran de "Hermosillo Ruta Extendida"
   * hasta jun-2026), así que la cobertura debe reflejar quién atiende hoy cada CP.
   *
   * La sucursal que cuenta es la DUEÑA DEL CONSOLIDADO (a quién se sube el archivo),
   * no la de la guía: Caborca/Peñasco/Santa Ana se suben a Bodega Hermosillo y luego
   * sus guías se reparten a cada sucursal.
   */
  async rebuildFromHistory(days = Number(process.env.INBOX_COVERAGE_DAYS ?? 90)): Promise<{ pairs: number; days: number }> {
    const sql = (table: string, ownerJoin: string, ownerCol: string) => `
      SELECT x.recipientZip AS zip, COALESCE(${ownerCol}, x.subsidiaryId) AS subsidiaryId,
             UPPER(TRIM(x.recipientCity)) AS city, COUNT(*) AS n,
             MIN(x.createdAt) AS firstSeen, MAX(x.createdAt) AS lastSeen
      FROM \`${table}\` x ${ownerJoin}
      WHERE COALESCE(${ownerCol}, x.subsidiaryId) IS NOT NULL AND x.recipientZip IS NOT NULL AND x.recipientZip <> ''
        AND x.createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY x.recipientZip, COALESCE(${ownerCol}, x.subsidiaryId), UPPER(TRIM(x.recipientCity))`;
    const raw: any[] = [
      ...(await this.ds.query(sql('shipment', 'LEFT JOIN consolidated o ON o.id = x.consolidatedId', 'o.subsidiaryId'), [days])),
      ...(await this.ds.query(
        sql('charge_shipment', 'LEFT JOIN consolidated o ON o.id = x.consolidatedId LEFT JOIN charge ch ON ch.id = x.chargeId', 'COALESCE(o.subsidiaryId, ch.subsidiaryId)'),
        [days],
      )),
    ];
    // Lo que salió de la ventana deja de contar (sin borrar filas ni tocar su status).
    await this.ds.query(`UPDATE subsidiary_zip_coverage SET shipmentCount = 0 WHERE source = 'historial'`);
    const rows: ZipCountRow[] = raw.map((r) => ({
      zip: r.zip,
      subsidiaryId: r.subsidiaryId,
      city: r.city,
      n: Number(r.n),
      firstSeen: r.firstSeen ? new Date(r.firstSeen) : null,
      lastSeen: r.lastSeen ? new Date(r.lastSeen) : null,
    }));
    const shares = computeZipShares(rows);
    for (let i = 0; i < shares.length; i += 500) {
      const chunk = shares.slice(i, i + 500);
      const values = chunk.map(() => `(?, ?, ?, ?, ?, ?, 'historial', 'sugerido', ?, ?)`).join(',');
      const params = chunk.flatMap((s) => [randomUUID(), s.zip, s.subsidiaryId, s.city, s.shipmentCount, s.share, s.firstSeenAt, s.lastSeenAt]);
      await this.ds.query(
        `INSERT INTO subsidiary_zip_coverage (id, zip, subsidiaryId, city, shipmentCount, share, source, status, firstSeenAt, lastSeenAt)
         VALUES ${values}
         ON DUPLICATE KEY UPDATE city = VALUES(city), shipmentCount = VALUES(shipmentCount),
           firstSeenAt = LEAST(COALESCE(firstSeenAt, VALUES(firstSeenAt)), COALESCE(VALUES(firstSeenAt), firstSeenAt)),
           lastSeenAt = GREATEST(COALESCE(lastSeenAt, VALUES(lastSeenAt)), COALESCE(VALUES(lastSeenAt), lastSeenAt))`,
        params,
      );
    }
    await this.recomputeShares();
    this.logger.log(`🗺️ cobertura CP recalculada (${days} días): ${shares.length} pares CP–sucursal`);
    return { pairs: shares.length, days };
  }

  /** Recalcula la proporción de cada sucursal dentro de su CP (todos o solo los dados). */
  async recomputeShares(zips?: string[]): Promise<void> {
    const where = zips?.length ? `WHERE zip IN (${zips.map(() => '?').join(',')})` : '';
    await this.ds.query(
      `UPDATE subsidiary_zip_coverage c
       JOIN (SELECT zip, SUM(shipmentCount) AS t FROM subsidiary_zip_coverage ${where} GROUP BY zip) s ON s.zip = c.zip
       SET c.share = IF(s.t > 0, c.shipmentCount / s.t, 0)`,
      zips ?? [],
    );
  }

  /** Suma los CP de un correo confirmado a la sucursal confirmada. */
  async addFromConfirmed(zips: Record<string, number>, subsidiaryId: string): Promise<void> {
    const entries = Object.entries(zips)
      .map(([z, n]) => [cleanZip(z), n] as const)
      .filter((e): e is readonly [string, number] => !!e[0] && e[1] > 0);
    if (!entries.length) return;
    for (const [zip, n] of entries) {
      await this.ds.query(
        `INSERT INTO subsidiary_zip_coverage (id, zip, subsidiaryId, shipmentCount, share, source, status, firstSeenAt, lastSeenAt)
         VALUES (?, ?, ?, ?, 0, 'correo', 'sugerido', NOW(), NOW())
         ON DUPLICATE KEY UPDATE shipmentCount = shipmentCount + VALUES(shipmentCount), lastSeenAt = NOW()`,
        [randomUUID(), zip, subsidiaryId, n],
      );
    }
    await this.recomputeShares(entries.map((e) => e[0]));
  }

  async list(subsidiaryId?: string): Promise<(SubsidiaryZipCoverage & { sharedWith: string[] })[]> {
    const rows = await this.repo.find({ where: subsidiaryId ? { subsidiaryId } : {}, order: { zip: 'ASC' } });
    if (!rows.length) return [];
    const zips = [...new Set(rows.map((r) => r.zip))];
    const others: { zip: string; subsidiaryId: string }[] = await this.ds.query(
      `SELECT zip, subsidiaryId FROM subsidiary_zip_coverage WHERE status <> 'excluido' AND zip IN (${zips.map(() => '?').join(',')})`,
      zips,
    );
    return rows.map((r) => ({
      ...r,
      sharedWith: others.filter((o) => o.zip === r.zip && o.subsidiaryId !== r.subsidiaryId).map((o) => o.subsidiaryId),
    }));
  }

  async setStatus(id: string, status: ZipCoverageStatus): Promise<SubsidiaryZipCoverage> {
    if (!['sugerido', 'confirmado', 'excluido'].includes(status)) throw new BadRequestException('Estado no válido');
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('No se encontró ese código postal');
    row.status = status;
    return this.repo.save(row);
  }

  async addManual(dto: { zip: string; subsidiaryId: string; city?: string | null }): Promise<SubsidiaryZipCoverage> {
    const zip = cleanZip(dto.zip);
    if (!zip) throw new BadRequestException('Escribe un código postal de 5 dígitos');
    if (!dto.subsidiaryId) throw new BadRequestException('Elige la sucursal');
    const existing = await this.repo.findOne({ where: { zip, subsidiaryId: dto.subsidiaryId } });
    if (existing) {
      existing.status = 'confirmado';
      if (dto.city) existing.city = dto.city;
      return this.repo.save(existing);
    }
    const row = await this.repo.save(
      this.repo.create({ zip, subsidiaryId: dto.subsidiaryId, city: dto.city ?? null, shipmentCount: 0, share: '0', source: 'manual', status: 'confirmado', firstSeenAt: new Date(), lastSeenAt: new Date() }),
    );
    await this.recomputeShares([zip]);
    return row;
  }
}
