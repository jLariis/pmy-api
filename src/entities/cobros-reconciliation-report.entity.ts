import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Snapshot persistido de la reconciliación diaria de cobros (para ver tendencia).
 * Read-only respecto a cobros: solo guarda contadores + muestras, no toca Income.
 */
@Entity('cobros_reconciliation_report')
@Index('IDX_cobros_recon_runAt', ['runAt'])
export class CobrosReconciliationReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  runAt: Date;

  @Column({ type: 'int', default: 14 })
  windowDays: number;

  @Column({ type: 'int', default: 0 })
  deliveredShipments: number;

  @Column({ type: 'int', default: 0 })
  missingCount: number;

  @Column({ type: 'int', default: 0 })
  orphanCount: number;

  @Column({ type: 'longtext', nullable: true })
  missingSample: string | null; // JSON.stringify(string[]) (tope)

  @Column({ type: 'longtext', nullable: true })
  orphanSample: string | null; // JSON.stringify(string[]) (tope)
}
