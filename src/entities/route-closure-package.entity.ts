import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Foto del cierre (migración 119): estatus y código con los que quedó cada guía/carga de la
 * salida al cerrarla. Se escribe en la misma transacción del cierre y no se modifica después.
 */
@Entity('route_closure_package')
@Index('IDX_rcp_dispatch', ['dispatchId'])
@Index('IDX_rcp_closure', ['routeClosureId'])
export class RouteClosurePackage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  routeClosureId: string;

  @Column({ type: 'char', length: 36 })
  dispatchId: string;

  @Column({ type: 'char', length: 36, nullable: true })
  shipmentId: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  chargeShipmentId: string | null;

  @Column({ type: 'varchar', length: 64 })
  trackingNumber: string;

  @Column({ type: 'varchar', length: 64 })
  status: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  exceptionCode: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
