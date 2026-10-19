import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { Bump, ReleaseNote } from '../deploy/release.util';

/** Versión publicada del sistema (una fila por actualización exitosa). Semilla: 2.0.0. */
@Entity('app_release')
export class AppRelease {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  version: string;

  @Column({ type: 'varchar', length: 10 })
  bump: Bump;

  /** Notas finales (ya editadas) que ven los usuarios en el aviso de novedades. */
  @Column({ type: 'json', nullable: true })
  notes: ReleaseNote[] | null;

  /** Ids de archivos de nota ya publicados (el servidor nunca los borra de git). */
  @Column({ type: 'json', nullable: true })
  publishedNoteIds: string[] | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  apiCommit: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  webCommit: string | null;

  @Column({ type: 'datetime' })
  publishedAt: Date;

  @Column({ type: 'varchar', length: 36, nullable: true })
  publishedById: string | null;
}
