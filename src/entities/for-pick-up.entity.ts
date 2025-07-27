import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";

@Entity('for-pick-up')
export class ForPickUp {
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

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

}