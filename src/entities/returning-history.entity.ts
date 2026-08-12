import {
    BeforeInsert,
    Column,
    Entity,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
} from "typeorm";
import { Devolution } from "./devolution.entity";
import { Collection } from "./collection.entity";
import { Subsidiary } from "./subsidiary.entity";
import { Vehicle } from "./vehicle.entity";
import { Driver } from "./driver.entity";
import { EmailStatus } from "src/common/enums/email-status.enum";

/**
 * "Salida de Devoluciones y Recolecciones": un lote/salida agrupa las devoluciones y
 * recolecciones capturadas juntas por un chofer (o varios) en una unidad. Permite consultar
 * el historial por salida (trackingNumber, fecha, sucursal, chofer, unidad) en vez de por guía.
 */
@Entity('returning_history')
export class ReturningHistory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /**
     * Identificador de la salida (12 dígitos), como en las demás entidades de operación
     * (package_dispatch, unloading, inventory). Se genera en BeforeInsert.
     */
    @Index()
    @Column({ type: 'varchar', length: 255 })
    trackingNumber: string;

    @Column({ type: 'timestamp' })
    date: Date;

    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'subsidiaryId' })
    subsidiary: Subsidiary;

    @Index()
    @Column({ type: 'varchar', length: 36, nullable: true })
    subsidiaryId: string | null;

    @ManyToOne(() => Vehicle, { nullable: true })
    @JoinColumn({ name: 'vehicleId' })
    vehicle: Vehicle;

    @Column({ type: 'varchar', length: 36, nullable: true })
    vehicleId: string | null;

    /** Choferes de la salida (el formulario permite seleccionar varios). */
    @ManyToMany(() => Driver, { cascade: false })
    @JoinTable({
        name: 'returning_history_drivers',
        joinColumn: { name: 'returningHistoryId', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'driverId', referencedColumnName: 'id' },
    })
    drivers: Driver[];

    /** Contadores denormalizados para pintar el listado sin cargar los hijos. */
    @Column({ type: 'int', default: 0 })
    devolutionsCount: number;

    @Column({ type: 'int', default: 0 })
    collectionsCount: number;

    /** Usuario que registró la salida (auditoría). */
    @Column({ type: 'char', length: 36, nullable: true })
    createdById?: string;

    @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    /** Estado denormalizado del correo de la salida (para pintar el botón/tooltip). */
    @Column({ type: 'enum', enum: EmailStatus, default: EmailStatus.NOT_SENT })
    emailStatus: EmailStatus;

    @Column({ type: 'timestamp', nullable: true })
    emailLastSentAt?: Date;

    @Column({ type: 'varchar', length: 500, nullable: true })
    emailLastError?: string;

    @OneToMany(() => Devolution, (devolution) => devolution.returningHistory)
    devolutions: Devolution[];

    @OneToMany(() => Collection, (collection) => collection.returningHistory)
    collections: Collection[];

    @BeforeInsert()
    setDefaults() {
        if (!this.trackingNumber) {
            this.trackingNumber = this.generateTrackingNumber();
        }
    }

    /** 12 dígitos: últimos 8 del timestamp + 4 aleatorios (igual que package_dispatch/inventory). */
    private generateTrackingNumber(): string {
        const timestampPart = Date.now().toString().slice(-8);
        const randomPart = Math.floor(1000 + Math.random() * 9000).toString();
        return `${timestampPart}${randomPart}`;
    }
}
