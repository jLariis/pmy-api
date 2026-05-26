import { Driver, Subsidiary, User, Vehicle } from "src/entities";
import { Column, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

export interface ShipmentRemittanceSnapShot {
    pieceTrackingNumber: string;
    shipmentId: string;
}

export interface ShipmentSnapshot {
    id: string;
    trackingNumber: string; 
    shipmentType: string;
    isCharge: boolean;
    remittances?: ShipmentRemittanceSnapShot[];
}

@Entity('warehouse_receiving')
export class WarehouseReceiving {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'warehouseId' })
    warehouse: Subsidiary;
    
    @Column({ nullable: true })
    warehouseId: string;

    @Column({ type: 'json' })
    shipments: ShipmentSnapshot[];

    @ManyToMany(() => Driver, { nullable: true })
    @JoinTable({
    name: 'warehouse_receiving_drivers',
    joinColumn: { name: 'warehouseReceivingId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'driverId', referencedColumnName: 'id' },
    })
    drivers: Driver[] | null;

    @ManyToOne(() => Vehicle, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'vehicleId' })
    vehicle: Vehicle | null;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'createdById' })
    createdBy: User;

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    updatedAt: Date;

}
