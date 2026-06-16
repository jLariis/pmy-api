import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";
import { User } from "./user.entity";
import { Shipment } from "./shipment.entity";
import { ChargeShipment } from "./charge-shipment.entity";

/**
 * Traspaso de un paquete entre sucursales para corregir un mal enrutamiento
 * (FedEx/DHL lo mandaron a la sucursal equivocada). Se registra desde
 * inventario / salida a ruta cuando un paquete "no pertenece a la sucursal".
 */
@Entity('package_transfer')
export class PackageTransfer {
    @Index()
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    trackingNumber: string;

    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'originId' })
    origin: Subsidiary;

    @Column({ nullable: true })
    originId: string;

    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'destinationId' })
    destination: Subsidiary;

    @Column({ nullable: true })
    destinationId: string;

    @ManyToOne(() => Shipment, { nullable: true })
    @JoinColumn({ name: 'shipmentId' })
    shipment: Shipment;

    @Column({ nullable: true })
    shipmentId: string;

    @ManyToOne(() => ChargeShipment, { nullable: true })
    @JoinColumn({ name: 'chargeShipmentId' })
    chargeShipment: ChargeShipment;

    @Column({ nullable: true })
    chargeShipmentId: string;

    /** Origen del registro: 'inventory' | 'package_dispatch'. */
    @Column({ nullable: true })
    source: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    reason: string;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'createdById' })
    createdBy: User;

    @Column({ nullable: true })
    createdById: string;

    @Column({ type: 'datetime' })
    date: Date;

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}
