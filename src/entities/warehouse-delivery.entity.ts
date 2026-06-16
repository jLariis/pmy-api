import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";
import { User } from "./user.entity";
import { Shipment } from "./shipment.entity";
import { ChargeShipment } from "./charge-shipment.entity";

/**
 * Paquetes ENTREGADOS en bodega (entrega final al cliente en la sucursal).
 * Separada de `for-pick-up` (que es para "ocurre", paquetes que esperan ser
 * recogidos): un entregado ya es una entrega completada, no un pendiente.
 */
@Entity('warehouse_delivery')
export class WarehouseDelivery {
    @Index()
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    trackingNumber: string;

    @Column({ type: 'datetime' })
    date: Date;

    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'subsidiaryId' })
    subsidiary: Subsidiary;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'createdById' })
    createdBy: User;

    @Column({ nullable: true })
    createdById: string;

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

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}
