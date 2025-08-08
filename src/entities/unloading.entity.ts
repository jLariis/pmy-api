import { PrimaryGeneratedColumn, OneToMany, Column, JoinColumn, ManyToOne, Entity } from "typeorm";
import { ChargeShipment } from "./charge-shipment.entity";
import { Shipment } from "./shipment.entity";
import { Vehicle } from "./vehicle.entity";
import { Subsidiary } from "./subsidiary.entity";

@Entity('unloading')
export class Unloading {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @OneToMany(() => Shipment, (shipment) => shipment.packageDispatch)
    shipments: Shipment[];

    @OneToMany(() => ChargeShipment, (chargeShipment) => chargeShipment.packageDispatch)
    chargeShipments: ChargeShipment[];

    @ManyToOne(() => Vehicle, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'vehicleId' })
    vehicle: Vehicle | null; // Fixed type

    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'subsidiaryId' })
    subsidiary: Subsidiary | null;

    @Column({ type: 'json' })
    missingTrackings: string[];
    
    @Column({ type: 'json' })
    unScannedTrackings: string[];

    @Column({ type: 'timestamp', nullable: true })
    date: Date | null; // Allow nullable

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}