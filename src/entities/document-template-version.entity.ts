// src/entities/document-template-version.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type VersionStatus = 'draft' | 'published' | 'archived';

/** Versión inmutable de una plantilla. Restaurar = clonar en una versión nueva. */
@Entity('document_template_version')
@Index('uq_dtv_template_version', ['templateId', 'version'], { unique: true })
export class DocumentTemplateVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) templateId: string; // FK real → document_template.id
  @Column({ type: 'int' }) version: number;
  @Column({ type: 'varchar', length: 20, default: 'draft' }) status: VersionStatus;
  @Column({ type: 'varchar', length: 300, nullable: true }) subject: string | null;
  @Column({ type: 'json', nullable: true }) designJson: any;
  @Column({ type: 'longtext', nullable: true }) compiledBody: string | null;
  @Column({ type: 'varchar', length: 20, default: 'handlebars' }) engine: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) changelog: string | null;
  @Column({ type: 'char', length: 36, nullable: true }) createdById: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) createdByName: string | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
  @Column({ type: 'datetime', nullable: true }) publishedAt: Date | null;
}
