import { OutboundType } from "src/common/enums/outbound-type.enum";
import { Driver, Route, ShipmentSnapshot, Subsidiary, User, Vehicle } from "src/entities";
import { Column, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

@Entity('warehouse_outbound')
export class WarehouseOutbound {
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
    name: 'warehouse_outbound_drivers',
    joinColumn: { name: 'warehouseOutboundId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'driverId', referencedColumnName: 'id' },
    })
    drivers: Driver[] | null;

    @ManyToOne(() => Vehicle, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'vehicleId' })
    vehicle: Vehicle | null;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'createdById' })
    createdBy: User;

    @Column({type: 'enum', enum: OutboundType})
    type: OutboundType;

    @Column({ nullable: true })
    destinationId: string;

    @Column({ nullable: true })
    kms: number;

    @ManyToMany(() => Route, { nullable: true })
    @JoinTable({
        name: 'warehouse_outbound_routes',
        joinColumn: { name: 'warehouseOutboundId', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'routeId', referencedColumnName: 'id' },
    })
    routes: Route[] | null;

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    updatedAt: Date;

}
