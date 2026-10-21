import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { RouteClosure } from "./route-closure.entity";

/**
 * Auditoría de los estatus capturados a mano en el cierre de ruta con pre-cierre
 * (sucursales con `subsidiary.routeClosureWithPreClosure`). Un renglón por guía cambiada.
 * Mismo espíritu que `shipment_not_in_files` para No VAN. Migración 1786000000115.
 */
@Entity('route_closure_manual_status')
export class RouteClosureManualStatus {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => RouteClosure, { nullable: false })
    @JoinColumn({ name: 'routeClosureId' })
    routeClosure: RouteClosure;

    @Index('idx_rcms_routeClosureId')
    @Column()
    routeClosureId: string;

    @Column({ type: 'varchar', length: 36, nullable: true })
    shipmentId: string | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    chargeShipmentId: string | null;

    @Index('idx_rcms_trackingNumber')
    @Column()
    trackingNumber: string;

    @Column({ length: 64 })
    previousStatus: string;

    @Column({ length: 64 })
    newStatus: string;

    @Column({ type: 'varchar', length: 16, nullable: true })
    exceptionCode: string | null;

    @Column({ type: 'text' })
    reason: string;

    @Column({ type: 'varchar', length: 36, nullable: true })
    createdById: string | null;

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}
