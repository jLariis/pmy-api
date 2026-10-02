import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Avance de lectura del buzón (último UID leído) y estado de la conexión. */
@Entity('inbox_sync_state')
export class InboxSyncState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  mailbox: string;

  @Column({ type: 'bigint', nullable: true })
  uidValidity: string | null;

  @Column({ type: 'int', default: 0 })
  lastUid: number;

  @Column({ type: 'datetime', nullable: true })
  lastRunAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastOkAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;
}
