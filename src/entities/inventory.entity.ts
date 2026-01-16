import { BeforeInsert, Column, Entity, In, JoinColumn, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Shipment } from "./shipment.entity";
import { ChargeShipment } from "./charge-shipment.entity";
import { Subsidiary } from "./subsidiary.entity";
import { InventoryType } from "src/common/enums/inventory-type.enum";

@Entity('inventory')
export class Inventory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    trackingNumber: string;

    @Column({ type: 'datetime' })
    inventoryDate: Date;

    @ManyToMany(() => Shipment, { nullable: true })
    @JoinTable({
        name: 'inventory_shipment',
        joinColumn: { name: 'inventoryId', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'shipmentId', referencedColumnName: 'id' },
    })
    shipments: Shipment[] | null;

    @ManyToMany(() => ChargeShipment, { nullable: true })
    @JoinTable({
        name: 'inventory_charge_shipments',
        joinColumn: { name: 'inventoryId', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'chargeShipmentId', referencedColumnName: 'id' },
    })
    chargeShipments: ChargeShipment[] | null;

    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'subsidiaryId' })
    subsidiary: Subsidiary | null;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({ type: 'enum', enum: InventoryType, nullable: true , default: InventoryType.INITIAL})
    type: InventoryType | null;

    @BeforeInsert()
    setDefaults() {
      this.createdAt = new Date();
      this.trackingNumber = this.generateTrackingNumber();
    }

    private generateTrackingNumber(): string {
        // Combina timestamp y random para asegurar unicidad y longitud de 12 dígitos
        const timestampPart = Date.now().toString().slice(-8); // últimos 8 dígitos del timestamp
        const randomPart = Math.floor(1000 + Math.random() * 9000).toString(); // 4 dígitos aleatorios
        return `${timestampPart}${randomPart}`; // Total: 12 dígitos
    }
}
