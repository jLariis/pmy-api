import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Una fila por guía por corrida: lo que el motor HARÍA (shadow), sin tocar shipment_status. */
@Entity('tracking_sync_observation')
@Unique('uq_run_shipment', ['runId', 'shipmentId'])
export class TrackingSyncObservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'char', length: 36 })
  runId: string;

  @Index()
  @Column({ type: 'char', length: 36 })
  shipmentId: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  trackingNumber: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  proposedStatus: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  legacyCurrentStatus: string | null;

  @Column({ type: 'int', default: 0 })
  wouldInsertEvents: number;

  /** JSON string con las eventKey que insertaría (trazabilidad). */
  @Column({ type: 'text', nullable: true })
  wouldInsertEventKeys: string | null;

  @Column({ default: false })
  matchesLegacy: boolean;

  /** JSON string con issues de validación. */
  @Column({ type: 'text', nullable: true })
  issues: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
