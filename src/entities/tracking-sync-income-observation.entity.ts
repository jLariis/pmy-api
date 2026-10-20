import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Cobro que el motor nuevo PROPONDRÍA en sombra (sin escribir income), uno por efecto de cobro
 * por corrida. Sirve para medir la paridad de COBROS contra el legacy antes de ampliar el cutover
 * (la observación de estatus vive en tracking_sync_observation).
 */
@Entity('tracking_sync_income_observation')
@Index('IDX_tsio_tracking_created', ['trackingNumber', 'createdAt'])
export class TrackingSyncIncomeObservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_tsio_run')
  @Column({ type: 'char', length: 36 })
  runId: string;

  @Column({ type: 'char', length: 36, nullable: true })
  shipmentId: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  subsidiaryId: string | null;

  @Column({ type: 'varchar', length: 255 })
  trackingNumber: string;

  @Column({ type: 'varchar', length: 32 })
  incomeType: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  exceptionCode: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  cost: string;

  /** Instante del evento FedEx que ancla el cobro. */
  @Column({ type: 'datetime' })
  occurredAt: Date;

  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceEventKey: string | null;

  /** ¿Ya había un ingreso de esa guía en esa semana (cualquier origen)? */
  @Column({ default: false })
  alreadyExists: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
