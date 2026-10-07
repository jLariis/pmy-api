import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ApprovalType =
  | 'delete_consolidado'
  | 'delete_route_dispatch'
  | 'change_subsidiary_consolidado'
  | 'change_date_consolidado'
  | 'change_type_consolidado';

/** Acciones sobre consolidado (aplican a la familia consNumber+sucursal). */
export const CONSOLIDATED_ACTION_TYPES: ApprovalType[] = [
  'delete_consolidado',
  'change_subsidiary_consolidado',
  'change_date_consolidado',
  'change_type_consolidado',
];
export type ApprovalStatus = 'pendiente' | 'aprobado' | 'rechazado';

/**
 * Solicitud de autorización: borrado (baja lógica) de consolidado o salida a ruta,
 * o cambio de sucursal/fecha de un consolidado. La aprueba el supervisor (o un superadmin).
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

  /** Por qué se pide (obligatorio en acciones de consolidado). */
  @Column({ type: 'text', nullable: true })
  justification: string | null;

  /** Cambio pedido: `{ newSubsidiaryId }` o `{ newDate: 'yyyy-MM-dd' }`. */
  @Column({ type: 'json', nullable: true })
  payload: any;

  /** Familia del consolidado: `CONSNUMBER|subsidiaryId` (una pendiente por familia). */
  @Index('IDX_approval_request_targetKey')
  @Column({ type: 'varchar', length: 160, nullable: true })
  targetKey: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  targetLabel: string | null;

  /** Impacto recalculado al momento de aplicar. */
  @Column({ type: 'json', nullable: true })
  impactAfter: any;

  /** Conteos aplicados (guías, cargas, ingresos, montos). */
  @Column({ type: 'json', nullable: true })
  resultSummary: any;

  @Column({ type: 'datetime', nullable: true })
  executedAt: Date | null;

  /** Si falló al aplicar: la solicitud sigue pendiente y aquí queda el motivo. */
  @Column({ type: 'text', nullable: true })
  executionError: string | null;
}
