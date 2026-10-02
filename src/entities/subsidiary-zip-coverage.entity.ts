import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ZipCoverageStatus = 'sugerido' | 'confirmado' | 'excluido';

/** Cobertura de códigos postales por sucursal (del historial, de correos confirmados o manual). */
@Entity('subsidiary_zip_coverage')
@Index('UQ_subsidiary_zip_coverage', ['zip', 'subsidiaryId'], { unique: true })
export class SubsidiaryZipCoverage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 10 })
  zip: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  subsidiaryId: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string | null;

  @Column({ type: 'int', default: 0 })
  shipmentCount: number;

  /** Proporción (0–1) de las guías de este CP que son de esta sucursal. */
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  share: string;

  @Column({ type: 'varchar', length: 10, default: 'historial' })
  source: 'historial' | 'correo' | 'manual';

  @Column({ type: 'varchar', length: 10, default: 'sugerido' })
  status: ZipCoverageStatus;

  @Column({ type: 'datetime', nullable: true })
  firstSeenAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastSeenAt: Date | null;
}
