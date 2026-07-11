// src/entities/template-render-log.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RenderStatus = 'ok' | 'fallback' | 'error';

/** Observabilidad best-effort de cada render. */
@Entity('template_render_log')
@Index('idx_trl_code_created', ['code', 'createdAt'])
export class TemplateRenderLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 80 }) code: string;
  @Column({ type: 'int', default: 0 }) version: number;
  @Column({ type: 'varchar', length: 20 }) format: string;
  @Column({ type: 'varchar', length: 20 }) status: RenderStatus;
  @Column({ type: 'varchar', length: 64, nullable: true }) entityId: string | null;
  @Column({ type: 'int', nullable: true }) ms: number | null;
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
}
