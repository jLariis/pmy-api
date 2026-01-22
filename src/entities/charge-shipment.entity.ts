import { BeforeInsert, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn } from "typeorm";
import { Shipment } from "./shipment.entity";
import { Charge } from "./charge.entity";
import { PackageDispatch } from "./package-dispatch.entity";
import { Priority } from "src/common/enums/priority.enum";
import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";
import { ShipmentType } from "src/common/enums/shipment-type.enum";
import { Payment } from "./payment.entity";
import { ShipmentStatus } from "./shipment-status.entity";
import { Subsidiary } from "./subsidiary.entity";
import { Unloading } from "./unloading.entity";

@Entity('charge_shipment')
export class ChargeShipment {
    
    @ManyToOne(() => Charge, { nullable: true })
    @JoinColumn({ name: 'chargeId' })
    @Index()
    charge: Charge;

    
      @PrimaryGeneratedColumn('uuid')
      @Index()
      id: string;
    
      @Column()
      trackingNumber: string;
    
      
      @Column({
        type: 'enum',
        enum: ShipmentType,
        default: ShipmentType.FEDEX,
      })
      @Index()
      shipmentType: ShipmentType;
    
      @Column()
      recipientName: string;
    
      @Column()
      recipientAddress: string;
    
      @Column()
      recipientCity: string;
    
      @Column()
      recipientZip: string;

      @Column({ type: 'datetime' })
      commitDateTime: Date;
    
      @Column()
      recipientPhone: string;
    
      @Index()
      @Column({
        type: 'enum',
        enum: ShipmentStatusType,
        default: ShipmentStatusType.PENDIENTE,
      })
      status: ShipmentStatusType;
    
      @Column({
        type: 'enum',
        enum: Priority,
        default: Priority.BAJA,
      })
      priority: Priority;
    
      @OneToOne(() => Payment, payment => payment.chargeShipment, { 
        cascade: true 
      })
      payment: Payment;
    
      @OneToMany(() => ShipmentStatus, status => status.chargeShipment, { cascade: true })
      statusHistory: ShipmentStatus[];
    
      @Column({ nullable: true })
      consNumber: string;
    
      @Column({ default: '' })
      receivedByName: string;
    
      @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
      createdAt: Date;
    
      @ManyToOne(() => Subsidiary, { nullable: true })
      @JoinColumn({ name: 'subsidiaryId' })
      subsidiary: Subsidiary;
    
      @Index()
      @Column({ nullable: true, default: null })
      consolidatedId: string;
    
      @Column({ nullable: true, default: false})
      isHighValue: boolean;
    
      @ManyToOne(() => PackageDispatch, packageDispatch => packageDispatch.shipments, {
        nullable: true,
        onDelete: 'SET NULL',
      })
      @JoinColumn({ name: 'routeId' })
      packageDispatch?: PackageDispatch;

      @ManyToOne(() => Unloading, unloading => unloading.shipments, {
        nullable: true,
        onDelete: 'SET NULL',
      })
      @JoinColumn({ name: 'unloadingId' })
      unloading?: Unloading;

      @Column({default: ''})
      exceptionCode: string;

      /**
       * Identificador único global de FedEx para evitar colisiones 
       * con números de guía reciclados.
       */
      @Index() // Esto crea el índice en la base de datos automáticamente
      @Column({ type: 'varchar', length: 255, nullable: true})
      fedexUniqueId: string;

      /**
       * Código del transportista (ej: FDXE para Express, FDXG para Ground).
       * Ayuda a que la API de FedEx responda más rápido al no tener que buscar en todas sus redes.
       */
      @Column({ type: 'varchar', length: 50, nullable: true})
      carrierCode: string;

      @BeforeInsert()
      setDefaults() {
        this.createdAt = new Date(); // Fecha en UTC (asegúrate de que el servidor esté en UTC)
      }
}