import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Subsidiary } from "./subsidiary.entity";
import { ReturningHistory } from "./returning-history.entity";

// Una guía puede vivir en varios consolidados (guías recicladas / máster DHL). La
// devolución es única por (trackingNumber + consolidatedId), no solo por la guía.
@Index('IDX_devolution_tracking_cons', ['trackingNumber', 'consolidatedId'])
@Entity('devolution')
export class Devolution {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ nullable: false })
    trackingNumber: string;

    /**
     * Consolidado del envío devuelto. Se deriva en backend del shipment/charge_shipment
     * más reciente que comparte la guía. Permite registrar una devolución por consolidado
     * (misma guía reciclada en otro consolidado) sin que la validación de duplicado la bloquee.
     */
    @Column({ type: 'varchar', length: 255, nullable: true, default: null })
    consolidatedId: string | null;

    /** Motivo de la devolución. Guarda el exceptionCode de FedEx (varchar, no enum). */
    @Column({ nullable: false })
    reason: string;

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

    /** Usuario que registró la devolución (auditoría). */
    @Column({ type: 'char', length: 36, nullable: true })
    createdById?: string;
}