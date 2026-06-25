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

  // ---- Configuración operativa por sucursal (antes hardcodeada en SUBSIDIARY_CONFIG) ----
  /** Monitoreo: alertar cuando falta el código 67 de FedEx (recepción en estación). */
  @Column({ default: false })
  monitorFedexCode67: boolean;

  /** Monitoreo: alertar cuando falta el código 44 de FedEx. */
  @Column({ default: false })
  monitorFedexCode44: boolean;

  /** Tracking: rastrear la entrega que hace FedEx por su cuenta (OD → "a cargo de FedEx"). */
  @Column({ default: false })
  trackFedexExternalDelivery: boolean;

  /** Tracking: dar prioridad al estatus reportado por FedEx para esta sucursal. */
  @Column({ default: false })
  forceFedexStatusOverride: boolean;

  /**
   * Salidas a ruta: si está activo, los paquetes se ORDENAN por código postal
   * (recipientZip) en el escaneo, PDF y Excel. Si está en false, se conserva el
   * orden en que se escanearon.
   */
  @Column({ default: false })
  sortDispatchByPostalCode: boolean;

  // ---- Reglas de INGRESO por sucursal (defaults = comportamiento histórico) ----
  /**
   * ¿El DEX03 (dirección incorrecta) cuenta como ingreso? Default false: el
   * registro SIEMPRE se crea y se conserva, pero se EXCLUYE del total mientras
   * sea false (para poder cobrarlo después con facturación dedicada).
   */
  @Column({ default: false })
  chargeDex03: boolean;

  /** ¿El DEX07 (rechazado) cobra/cuenta como ingreso? */
  @Column({ default: true })
  chargeDex07: boolean;

  /** ¿El DEX08 (cliente no disponible) cobra/cuenta como ingreso? */
  @Column({ default: true })
  chargeDex08: boolean;

  /** ¿El entregado cobra/cuenta como ingreso? */
  @Column({ default: true })
  chargeDelivered: boolean;

  /** ¿Generar ingreso DHL al detectar entrega (17track), no solo en cierre de ruta? */
  @Column({ default: true })
  generateDhlIncomeOnDelivery: boolean;

  /** ¿Los traslados (tyco/aeropuerto/especial) cuentan como ingreso en finanzas? */
  @Column({ default: true })
  countTransfersAsIncome: boolean;

  @BeforeInsert()
  setCreatedAt() {
    this.createdAt = new Date(); // Fecha en UTC
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date(); // Fecha en UTC
  }
}