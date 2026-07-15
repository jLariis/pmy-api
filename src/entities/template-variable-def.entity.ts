// src/entities/template-variable-def.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type VariableDataType = 'string' | 'number' | 'date' | 'currency' | 'boolean';

/** Variable declarada para una plantilla: paleta del editor + validación + sample. */
@Entity('template_variable_def')
@Index('idx_tvd_template', ['templateId'])
export class TemplateVariableDef {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) templateId: string; // FK real → document_template.id
  @Column({ type: 'varchar', length: 80 }) name: string;
  @Column({ type: 'varchar', length: 160 }) label: string;
  @Column({ type: 'varchar', length: 20, default: 'string' }) dataType: VariableDataType;
  @Column({ type: 'varchar', length: 300, nullable: true }) example: string | null;
  @Column({ type: 'boolean', default: false }) required: boolean;
}
