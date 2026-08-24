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

  // Costo de carga de 1.5 toneladas. 0 = no aplica para esta sucursal.
  // Se siembra en 4228 solo para Hermosillo (migración 1786000000045 / ...053).
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.00,
  })
  chargeCostHalfTon: number;

  // Sobreprecio de carga F2 normal en domingo/festivo. 0 = no aplica (usa chargeCost).
  // Se siembra en 6660 para Hermosillo (migración 1786000000053).
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.00,
  })
  chargeCostSundayHoliday: number;

  // Sobreprecio de carga 1.5 ton en domingo/festivo. 0 = no aplica (usa chargeCostHalfTon).
  // Se siembra en 6004 para Hermosillo (migración 1786000000053).
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.00,
  })
  chargeCostHalfTonSundayHoliday: number;

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

  // ---- Geolocalización (antes hardcodeada en el mapa del dashboard) ----
  /** Estado de la república donde está la sucursal (para el panel del mapa). */
  @Column({ default: '', nullable: true })
  state: string;

  /** Latitud para ubicar el marcador en el mapa interactivo. */
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: number | null;

  /** Longitud para ubicar el marcador en el mapa interactivo. */
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: number | null;

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
   * Tracking: sucursal que opera DESDE la bodega de FedEx. FedEx puede registrar
   * eventos (DEX 07/08, cambio de fecha, etc.) ANTES de que el paquete exista en
   * el sistema (antes de `createdAt`). Si está activo, esos eventos pre-registro
   * del MISMO DÍA calendario (zona Hermosillo) SÍ entran al pipeline de
   * historial/ingresos. NO relaja el Time Shield del estatus operativo.
   * Se siembra en true SOLO para Hermosillo y Cabo San Lucas (migración 052).
   */
  @Column({ default: false })
  allowSameDayPreRegistrationFedexEvents: boolean;

  /**
   * Salidas a ruta: si está activo, los paquetes se ORDENAN por código postal
   * (recipientZip) en el escaneo, PDF y Excel. Si está en false, se conserva el
   * orden en que se escanearon.
   */
  @Column({ default: false })
  sortDispatchByPostalCode: boolean;

  /**
   * Salidas a ruta: modo de validación de paquetes. Si está activo, el escaneo
   * completo se valida en UN solo request por lista (endpoint batch) y el backend
   * devuelve los paquetes ya ordenados. Si está en false (default), se conserva el
   * comportamiento histórico: validación uno-por-uno.
   */
  @Column({ default: false })
  validateDispatchByList: boolean;

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

  /**
   * Cierre de ruta: si está activo, se permite CERRAR la ruta aunque queden paquetes
   * en "Otros Estatus" (sin resolver) con fecha compromiso de hoy. Default false =
   * comportamiento histórico (bloquea). Se siembra en true solo para la sucursal
   * Hermosillo (no Bodega Hermosillo) en la migración 1786000000050.
   */
  @Column({ default: false })
  allowRouteClosureWithOtherStatus: boolean;

  /**
   * Encargado/Supervisor que autoriza los borrados (consolidado / salida a ruta)
   * de esta sucursal. Es un usuario registrado, configurable en Configuración.
   * Si es null, el aprobador cae al primer superadmin activo (Admin Principal).
   */
  @Column({ nullable: true })
  supervisorUserId: string | null;

  /**
   * Cobros: si está activo, al crear cargas F2/31.5 se SUMA `secondAbordAmount` al costo
   * de la carga (solo sobre el costo NORMAL: no aplica a 1.5 ton ni al sobreprecio de
   * domingo/festivo) y ese total va como ingreso. Se siembra en true solo para Hermosillo
   * (migración 1786000000057).
   */
  @Column({ default: false })
  chargeSecondAbord: boolean;

  @BeforeInsert()
  setCreatedAt() {
    this.createdAt = new Date(); // Fecha en UTC
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date(); // Fecha en UTC
  }
}