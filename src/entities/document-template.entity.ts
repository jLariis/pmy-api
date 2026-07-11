// src/entities/document-template.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type DocumentFormat =
  | 'email' | 'pdf' | 'excel' | 'report' | 'letter' | 'receipt' | 'label' | 'statement';

/** Plantilla de documento. Un `code` por documento (route_dispatch, unloading, …). */
@Entity('document_template')
@Index('uq_document_template_code_lang', ['code', 'language'], { unique: true })
export class DocumentTemplate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 80 }) code: string;
  @Column({ type: 'varchar', length: 160 }) name: string;
  @Column({ type: 'varchar', length: 20 }) type: DocumentFormat;
  @Column({ type: 'varchar', length: 300, nullable: true }) description: string | null;
  @Column({ type: 'varchar', length: 8, default: 'es' }) language: string;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ type: 'varchar', length: 60, nullable: true }) category: string | null;
  @Column({ type: 'char', length: 36, nullable: true }) currentVersionId: string | null;
  @Column({ type: 'char', length: 36, nullable: true }) tenantId: string | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) updatedAt: Date;
}
