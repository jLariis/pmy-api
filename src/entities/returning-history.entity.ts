import {
    Column,
    Entity,
    Generated,
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

/**
 * "Salida de Devoluciones y Recolecciones": un lote/salida agrupa las devoluciones y
 * recolecciones capturadas juntas por un chofer (o varios) en una unidad. Permite consultar
 * el historial por salida (folio, fecha, sucursal, chofer, unidad) en vez de por tracking.
 */
@Entity('returning_history')
export class ReturningHistory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** Folio consecutivo legible para operación (buscar la salida sin usar el uuid). */
    @Index({ unique: true })
    @Column({ type: 'int' })
    @Generated('increment')
    folio: number;

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

    @OneToMany(() => Devolution, (devolution) => devolution.returningHistory)
    devolutions: Devolution[];

    @OneToMany(() => Collection, (collection) => collection.returningHistory)
    collections: Collection[];
}
