import { PrimaryGeneratedColumn, OneToMany, Column, JoinColumn, ManyToOne, Entity, BeforeInsert } from "typeorm";
import { ChargeShipment } from "./charge-shipment.entity";
import { Shipment } from "./shipment.entity";
import { Vehicle } from "./vehicle.entity";
import { Subsidiary } from "./subsidiary.entity";

@Entity('unloading')
export class Unloading {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    trackingNumber: string;

    @OneToMany(() => Shipment, (shipment) => shipment.unloading)
    shipments: Shipment[];

    @OneToMany(() => ChargeShipment, (chargeShipment) => chargeShipment.unloading)
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

    @BeforeInsert()
      setDefaults() {
        this.createdAt = new Date();
        this.trackingNumber = this.generateDispatchNumber();
      }

    private generateDispatchNumber(): string {
    // Combina timestamp y random para asegurar unicidad y longitud de 12 dígitos
    const timestampPart = Date.now().toString().slice(-8); // últimos 8 dígitos del timestamp
    const randomPart = Math.floor(1000 + Math.random() * 9000).toString(); // 4 dígitos aleatorios
    return `${timestampPart}${randomPart}`; // Total: 12 dígitos
  }
}