import { DispatchStatus } from "src/common/enums/dispatch-enum";
import { Entity, PrimaryGeneratedColumn, OneToMany, Column, ManyToMany, JoinTable, ManyToOne, JoinColumn, BeforeInsert, BeforeUpdate } from "typeorm";
import { Driver } from "./driver.entity";
import { Route } from "./route.entity";
import { Shipment } from "./shipment.entity";
import { Subsidiary } from "./subsidiary.entity";
import { Vehicle } from "./vehicle.entity";

@Entity('package_dispatch') // Changed to snake_case for database consistency
export class PackageDispatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToMany(() => Shipment, (shipment) => shipment.packageDispatch)
  shipments: Promise<Shipment[]>;

  @Column({ unique: true })
  trackingNumber: string;

  @ManyToMany(() => Route, { nullable: true })
  @JoinTable({
    name: 'package_dispatch_routes',
    joinColumn: { name: 'dispatchId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'routeId', referencedColumnName: 'id' },
  })
  routes: Route[] | null;

  @ManyToMany(() => Driver, { nullable: true })
  @JoinTable({
    name: 'package_dispatch_drivers',
    joinColumn: { name: 'dispatchId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'driverId', referencedColumnName: 'id' },
  })
  drivers: Driver[] | null;

  @ManyToOne(() => Vehicle, { nullable: true })
  @JoinColumn({ name: 'vehicleId' })
  vehicle: Vehicle | null; // Fixed type

  @Column({
    type: 'enum',
    enum: DispatchStatus,
    default: DispatchStatus.EN_PROGRESO,
  })
  status: DispatchStatus;

  @Column({ type: 'timestamp', nullable: true })
  startTime: Date | null; // Allow nullable

  @Column({ type: 'timestamp', nullable: true })
  estimatedArrival: Date | null; // Allow nullable

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  updatedAt: Date | null;

  @BeforeInsert()
  setDefaults() {
    this.createdAt = new Date();
    this.trackingNumber = this.generateDispatchNumber();
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date();
  }

  private generateDispatchNumber(): string {
    // Combina timestamp y random para asegurar unicidad y longitud de 12 dígitos
    const timestampPart = Date.now().toString().slice(-8); // últimos 8 dígitos del timestamp
    const randomPart = Math.floor(1000 + Math.random() * 9000).toString(); // 4 dígitos aleatorios
    return `${timestampPart}${randomPart}`; // Total: 12 dígitos
  }
}