import { BeforeInsert, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Subsidiary } from './subsidiary.entity';
import { ConsolidatedType } from '../common/enums/consolidated-type.enum';

@Entity('consolidated')
export class Consolidated {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'datetime' })
  date: Date;

  @Column({
    type: 'enum',
    enum: ConsolidatedType,
    default: ConsolidatedType.ORDINARIA,
  })
  type: ConsolidatedType;

  @Column()
  numberOfPackages: number;

  @Index()
  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column()
  isCompleted: boolean;

  @Column({ nullable: true })
  consNumber: string;

  @Column({ nullable: true, default: 0 })
  efficiency: number;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @BeforeInsert()
  setDefaults() {
    this.createdAt = new Date(); // Fecha en UTC
    if (!this.date) {
      this.date = new Date(); // Asignar fecha actual en UTC si no se proporciona
    }
  }
}