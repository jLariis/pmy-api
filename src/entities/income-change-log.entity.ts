import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Historial de cambios del Consolidador de Finanzas. Una fila por cada modificación hecha desde
 * el consolidador (editar costo, 2º a bordo, alta manual, corregir estatus): qué acción, qué campo,
 * cómo estaba (oldValue) y cómo quedó (newValue), quién y cuándo, y el motivo.
 */
@Entity('income_change_log')
export class IncomeChangeLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'char', length: 36, nullable: true })
  incomeId?: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  shipmentId?: string | null;

  /** cost_edit | second_abord | manual_create | status_fix */
  @Column({ type: 'varchar', length: 40 })
  action: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  field?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  oldValue?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  newValue?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason?: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  userId?: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
