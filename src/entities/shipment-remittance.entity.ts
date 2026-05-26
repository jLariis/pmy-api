import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Shipment } from "./shipment.entity";
import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";
import { PackageDispatch } from "./package-dispatch.entity";
import { WarehouseReceiving } from "./warehouse-receiving.entity";

@Entity('shipment_remittance')
export class ShipmentRemittance {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 25, nullable: false })
    pieceTrackingNumber: string;
    
    @ManyToOne(() => Shipment, { nullable: true })
    @JoinColumn({ name: 'shipmentId' })
    shipment: Shipment;
    
    @Column({ nullable: true })
    shipmentId: string;

    @Column({
        type: 'enum',
        enum: ShipmentStatusType,
    })
    status: ShipmentStatusType;

    @ManyToOne(() => PackageDispatch, {
        nullable: true,
        onDelete: 'SET NULL',
    })
    @JoinColumn({ name: 'dispatchId' })
    packageDispatch?: PackageDispatch;

    @Column({ nullable: true })
    dispatchId?: string;

    @ManyToOne(() => WarehouseReceiving, { nullable: true })
    @JoinColumn({ name: 'warehouseReceivingId' })
    warehouseReceiving?: WarehouseReceiving;

    @Column({ nullable: true })
    warehouseReceivingId?: string;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;


}