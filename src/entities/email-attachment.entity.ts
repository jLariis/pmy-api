import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Referencia a un adjunto de correo guardado EN DISCO (no en la BD, para no
 * inflarla). Se persiste una sola vez por entidad origen; los reenvíos leen el
 * archivo desde `storagePath`. Genérica: se referencia por (`module`, `entityId`).
 *
 * `storagePath` es RELATIVO a `process.cwd()` (p.ej.
 * `uploads/email/package_dispatch/<id>/<file>`); al leer se resuelve con
 * `join(process.cwd(), storagePath)`. Si el operador purga el archivo del disco,
 * el reenvío usa el fallback de regeneración.
 */
@Entity('email_attachment')
@Index('IDX_email_attachment_entity', ['module', 'entityId'])
export class EmailAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  module: string;

  @Column({ type: 'varchar', length: 36 })
  entityId: string;

  /** Nombre original del archivo (el que se usa como nombre del adjunto). */
  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'varchar', length: 128 })
  mimeType: string;

  /** Tamaño en bytes. */
  @Column({ type: 'int' })
  size: number;

  /** Ruta relativa a process.cwd() donde vive el archivo en disco. */
  @Column({ type: 'varchar', length: 512 })
  storagePath: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
