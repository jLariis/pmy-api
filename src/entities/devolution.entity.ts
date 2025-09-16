import { ShipmentCanceledStatus } from "src/common/enums/shipment-status-type.enum";
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";
import { ReturningHistory } from "./returning-history.entity";

@Entity('devolution')
export class Devolution {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ nullable: false })
    trackingNumber: string;

    @Column({ nullable: false })
    reason: ShipmentCanceledStatus;

    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'subsidiaryId' })
    subsidiary: Subsidiary;

    @Column({ type: 'datetime' })
    date: Date;

    @ManyToOne(() => ReturningHistory, returningHistory => returningHistory.devolutions, {
        nullable: true,
        onDelete: 'SET NULL',
    })
    @JoinColumn({ name: 'returningHistoryId' })
    returningHistory?: ReturningHistory;
    
    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}