import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ApprovalType = 'delete_consolidado' | 'delete_route_dispatch';
export type ApprovalStatus = 'pendiente' | 'aprobado' | 'rechazado';

/**
 * Solicitud de autorización para un borrado (baja lógica) de consolidado o
 * salida a ruta. La aprueba el supervisor de la sucursal (o un superadmin).
 */
@Entity('approval_request')
export class ApprovalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  type: ApprovalType;

  @Index()
  @Column()
  targetId: string;

  @Column({ nullable: true })
  subsidiaryId: string | null;

  @Column({ nullable: true })
  requestedById: string | null;

  @Column({ nullable: true })
  requestedByName: string | null;

  @Index()
  @Column({ nullable: true })
  approverId: string | null;

  @Column({ nullable: true })
  approverName: string | null;

  @Index()
  @Column({ default: 'pendiente' })
  status: ApprovalStatus;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'json', nullable: true })
  impactSnapshot: any;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  resolvedAt: Date | null;
}
