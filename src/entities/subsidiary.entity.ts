import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  BeforeInsert,
  BeforeUpdate,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { User } from './user.entity';
import { Zone } from './zone.entity';

/**
 * MySQL `bit(1)` se lee como Buffer en TypeORM. Este transformer normaliza
 * lectura/escritura a boolean para que el API siempre exponga/acepte boolean
 * (evita el error "Data too long for column 'isWarehouse'" al re-guardar).
 */
const bitToBoolean = {
  from: (value: any): boolean => {
    if (value === null || value === undefined) return false;
    if (Buffer.isBuffer(value)) return value[0] === 1;
    if (typeof value === 'object' && 'data' in value) return value.data?.[0] === 1;
    return value === 1 || value === true || value === '1';
  },
  to: (value: any): number => {
    if (value && typeof value === 'object' && 'data' in value) return value.data?.[0] === 1 ? 1 : 0;
    return value ? 1 : 0;
  },
};

@Entity('subsidiary')
export class Subsidiary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ default: true })
  active: boolean;

  @Column({ default: '', nullable: true })
  officeManager: string;

  @Column({ default: '', nullable: true })
  managerPhone: string;

  @Column({ default: '', nullable: true })
  officeEmail: string

  @Column({ default: '', nullable: true })
  officeEmailToCopy: string

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.00,
  })
  fedexCostPackage: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.00,
  })
  dhlCostPackage: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.00,
  })
  chargeCost: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.00,
  })
  tycoAmount: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.00,
  })
  airportAmount: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.00,
  })
  secondAbordAmount: number;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ nullable: true })
  createdById: string;

  @Column({ type: 'bit', default: false, transformer: bitToBoolean })
  isWarehouse: boolean;

  @ManyToOne(() => Zone, { nullable: true })
  @JoinColumn({ name: 'zoneId' })
  zone: Zone;
  
  @Column({ nullable: true })
  zoneId: string;

  @BeforeInsert()
  setCreatedAt() {
    this.createdAt = new Date(); // Fecha en UTC
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date(); // Fecha en UTC
  }
}