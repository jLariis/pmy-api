import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ImportFileKind = 'master' | 'payment' | 'high_value' | 'f2';

/**
 * Archivo original de una importación FedEx (Aéreo/Master, Cobros, Alto Valor, F2).
 * Se guarda el binario en disco (`storagePath`, relativo a process.cwd()) y esta
 * fila con la metadata + el consolidado al que quedó ligado, para poder comprobar
 * "qué se subió exactamente" ante discrepancias.
 */
@Entity('import_file')
export class ImportFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'FEDEX' })
  carrier: string;

  @Column()
  kind: ImportFileKind;

  @Column()
  originalName: string;

  @Column()
  storagePath: string; // relativo a process.cwd()

  @Column({ default: 'application/octet-stream' })
  mimeType: string;

  @Column({ type: 'int', default: 0 })
  size: number;

  @Column({ type: 'int', nullable: true })
  rowCount: number | null;

  @Index()
  @Column({ nullable: true })
  subsidiaryId: string | null;

  @Column({ nullable: true })
  consNumber: string | null;

  @Index()
  @Column({ nullable: true })
  consolidatedId: string | null;

  @Column({ nullable: true })
  uploadedById: string | null;

  @Column({ nullable: true })
  uploadedByName: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
