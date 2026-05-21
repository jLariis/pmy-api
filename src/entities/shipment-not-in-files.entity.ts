import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";
import { PackageDispatch } from "./package-dispatch.entity";
import { RouteClosure } from "./route-closure.entity";


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

    @ManyToOne(() => PackageDispatch, { nullable: true })
    @JoinColumn({ name: 'dispatchId' })
    dispatch: PackageDispatch;

    @Column({ nullable: true })
    dispatchId: string;

    @ManyToOne(() => RouteClosure, { nullable: true })
    @JoinColumn({ name: 'routeClosureId' })
    routeClosure: RouteClosure;

    @Column({ nullable: true })
    routeClosureId: string;

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}