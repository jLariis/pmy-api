import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type PackageDispatchChangeAction = 'add' | 'remove';

/**
 * Bitácora de edición de una salida a ruta (permiso `operaciones.salidas.editar`):
 * qué guía se agregó o quitó, quién, cuándo y por qué. Es el rastro permanente:
 * al quitar una guía se borra su fila de `package_dispatch_history` (la salida ya
 * no la llevó) y lo que pasó queda aquí. Migración 118.
 */
@Entity('package_dispatch_change')
@Index('IDX_dispatch_change_dispatch', ['dispatchId', 'createdAt'])
export class PackageDispatchChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  dispatchId: string;

  @Column({ type: 'varchar', length: 8 })
  action: PackageDispatchChangeAction;

  @Column({ type: 'varchar', length: 64 })
  trackingNumber: string;

  @Column({ type: 'char', length: 36, nullable: true })
  shipmentId: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  chargeShipmentId: string | null;

  /** Estatus que tenía la guía antes del cambio (y al que regresó si se quitó). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  previousStatus: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  newStatus: string | null;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column({ type: 'char', length: 36, nullable: true })
  createdById: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
