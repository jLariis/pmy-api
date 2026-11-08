import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type RouteZipCoverageStatus = 'sugerido' | 'confirmado' | 'excluido';

/**
 * Códigos postales que atiende cada ruta. Se arma con el historial de salidas a ruta
 * (package_dispatch_history + package_dispatch_routes) y se ajusta a mano.
 * Base de las sugerencias de salida (CP + vencimiento + bodega).
 */
@Entity('route_zip_coverage')
@Index('UQ_route_zip_coverage', ['routeId', 'zip'], { unique: true })
export class RouteZipCoverage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  routeId: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  subsidiaryId: string;

  @Index()
  @Column({ type: 'varchar', length: 10 })
  zip: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  city: string | null;

  @Column({ type: 'int', default: 0 })
  shipmentCount: number;

  /** Proporción (0–1) de las guías de este CP, en la sucursal, que van a esta ruta. */
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  share: string;

  @Column({ type: 'varchar', length: 10, default: 'historial' })
  source: 'historial' | 'manual';

  @Column({ type: 'varchar', length: 10, default: 'sugerido' })
  status: RouteZipCoverageStatus;

  @Column({ type: 'datetime', nullable: true })
  firstSeenAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastSeenAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
