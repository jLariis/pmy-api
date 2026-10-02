import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AliasSignalType } from '../inbox/inbox.types';

/** Pista aprendida (término, remitente, copia, estación) → sucursal, con aciertos y errores. */
@Entity('inbox_signal_alias')
@Index('UQ_inbox_signal_alias', ['signalType', 'term', 'subsidiaryId'], { unique: true })
export class InboxSignalAlias {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 12 })
  signalType: AliasSignalType;

  @Column({ type: 'varchar', length: 320 })
  term: string;

  @Column({ type: 'varchar', length: 36 })
  subsidiaryId: string;

  @Column({ type: 'int', default: 0 })
  hits: number;

  @Column({ type: 'int', default: 0 })
  misses: number;

  @Column({ type: 'varchar', length: 12, default: 'confirmacion' })
  source: 'catalogo' | 'historial' | 'confirmacion' | 'manual';

  @Column({ type: 'datetime', nullable: true })
  lastSeenAt: Date | null;
}
