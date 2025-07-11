import { BeforeInsert, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Subsidiary } from './subsidiary.entity';

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

  @Column({ default: '' })
  status: string;

  @Column({ default: false })
  isPickUp: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @BeforeInsert()
  setDefaults() {
    this.createdAt = new Date(); // Fecha en UTC (asegúrate de que el servidor esté en UTC)
  }
}