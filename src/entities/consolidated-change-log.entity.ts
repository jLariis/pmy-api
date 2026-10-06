import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Bitácora de las acciones sobre consolidado con autorización (borrar, cambiar sucursal,
 * cambiar fecha): una fila por cada registro cambiado — qué entidad, qué campo, cómo estaba y
 * cómo quedó, quién lo aplicó y bajo qué solicitud (`approval_request`).
 */
@Entity('consolidated_change_log')
export class ConsolidatedChangeLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_ccl_request')
  @Column({ type: 'char', length: 36, nullable: true })
  approvalRequestId: string | null;

  /** delete_consolidado | change_subsidiary_consolidado | change_date_consolidado */
  @Column({ type: 'varchar', length: 40 })
  action: string;

  @Index('IDX_ccl_cons')
  @Column({ type: 'varchar', length: 255, nullable: true })
  consNumber: string | null;

  /** consolidated | shipment | charge_shipment | charge | income | devolution */
  @Column({ type: 'varchar', length: 30 })
  entityType: string;

  @Column({ type: 'varchar', length: 36 })
  entityId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  trackingNumber: string | null;

  @Column({ type: 'varchar', length: 60 })
  field: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  oldValue: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  newValue: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userName: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
