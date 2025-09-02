import { BeforeInsert, Column, CreateDateColumn, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, OneToOne, PrimaryGeneratedColumn } from "typeorm";
import { PackageDispatch } from "./package-dispatch.entity";
import { User } from "./user.entity";
import { Shipment } from "./shipment.entity";
import { Subsidiary } from "./subsidiary.entity";
import { json } from "stream/consumers";

@Entity('route_closure')
export class RouteClosure {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'timestamp'})
    closeDate: Date;
    
    @ManyToMany(() => Shipment)
    @JoinTable({
        name: 'route_closure_returned_packages',
        joinColumn: {
        name: 'route_closure_id',
        referencedColumnName: 'id'
        },
        inverseJoinColumn: {
        name: 'shipment_id',
        referencedColumnName: 'id'
        }
    })
    returnedPackages: Shipment[];

    // Relación Many-to-Many con paquetes POD (tabla intermedia automática)
    @ManyToMany(() => Shipment)
    @JoinTable({
        name: 'route_closure_pod_packages',
        joinColumn: {
        name: 'route_closure_id',
        referencedColumnName: 'id'
        },
        inverseJoinColumn: {
        name: 'shipment_id',
        referencedColumnName: 'id'
        }
    })
    podPackages: Shipment[];

    @OneToOne(() => PackageDispatch, packageDispatch => packageDispatch.routeClosure)
    @JoinColumn({ name: 'package_dispatch_id' })
    packageDispatch: PackageDispatch;

    @ManyToOne(() => User, { 
        nullable: true,
    })
    @JoinColumn({ name: 'created_by_user_id' })
    createdBy: User;

    @Column({type: 'json'})
    collections: string[];

    @Column({default: ''})
    actualKms: string;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @ManyToOne(() => Subsidiary, { nullable: true })
    @JoinColumn({ name: 'subsidiaryId' })
    subsidiary: Subsidiary | null;

    @BeforeInsert()
    setDefaults() {
       this.createdAt = new Date();
    }
}