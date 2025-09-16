import { BeforeInsert, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Subsidiary } from './subsidiary.entity';
import { ReturningHistory } from './returning-history.entity';

@Entity('collection')
export class Collection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false })
  trackingNumber: string;

  @Index()
  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ default: '' , nullable: true})
  status: string;

  @Column({ default: false })
  isPickUp: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ManyToOne(() => ReturningHistory, returningHistory => returningHistory.devolutions, {
          nullable: true,
          onDelete: 'SET NULL',
      })
      @JoinColumn({ name: 'returningHistoryId' })
      returningHistory?: ReturningHistory;

  @BeforeInsert()
  setDefaults() {
    this.createdAt = new Date(); // Fecha en UTC (asegúrate de que el servidor esté en UTC)
  }
}