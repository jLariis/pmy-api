import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AttachmentKind } from '../inbox/inbox.types';

/** Adjunto de un correo FedEx; el binario vive en disco (storagePath). */
@Entity('inbox_attachment')
export class InboxAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  inboxMessageId: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'varchar', length: 150, default: 'application/octet-stream' })
  contentType: string;

  @Column({ type: 'int', default: 0 })
  size: number;

  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ type: 'varchar', length: 500 })
  storagePath: string;

  @Column({ type: 'varchar', length: 20, default: 'other' })
  kind: AttachmentKind;

  @Column({ type: 'varchar', length: 10, default: 'nombre' })
  kindSource: 'nombre' | 'contenido' | 'manual';

  @Index()
  @Column({ type: 'varchar', length: 30, nullable: true })
  consNumber: string | null;

  @Column({ type: 'int', nullable: true })
  rowCount: number | null;

  @Column({ type: 'json', nullable: true })
  zipSummary: Record<string, number> | null;

  @Column({ type: 'json', nullable: true })
  citySummary: Record<string, number> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  parseError: string | null;

  /** Cuándo se mandó este archivo al "Pegar FedEx" desde la bandeja. */
  @Column({ type: 'datetime', nullable: true })
  pastedAt: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  pastedById: string | null;

  /** Bloques de este archivo ya subidos (un libro puede tener hojas YAQUI / F2 / HV). */
  @Column({ type: 'json', nullable: true })
  pastedKeys: string[] | null;
}
