import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";


@Entity('shipment_not_in_files')
export class ShipmentNotInFiles {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    trackingNumber: string;

    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'subsidiaryId' })
    subsidiary: Subsidiary;

    @Column({ nullable: true })
    subsidiaryId: string;

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}