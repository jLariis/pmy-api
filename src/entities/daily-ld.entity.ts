import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Foto de los LD de un día (guías que vencieron sin entregar, sin DEX válido ni movimiento). */
@Entity('daily_ld')
@Index('UQ_daily_ld', ['subsidiaryId', 'day', 'trackingNumber'], { unique: true })
export class DailyLd {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) subsidiaryId: string;
  @Column({ type: 'date' }) day: string;
  @Column({ type: 'varchar', length: 64 }) trackingNumber: string;
  @Column({ type: 'varchar', length: 36, nullable: true }) shipmentId: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) chargeShipmentId: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) consNumber: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) status: string | null;
  @CreateDateColumn() createdAt: Date;
}
