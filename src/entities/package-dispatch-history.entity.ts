import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { ChargeShipment } from "./charge-shipment.entity";
import { PackageDispatch } from "./package-dispatch.entity";
import { Shipment } from "./shipment.entity";

@Entity('package_dispatch_history')
export class PackageDispatchHistory {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PackageDispatch)
  @JoinColumn({ name: 'dispatchId' })
  dispatch: PackageDispatch;

  @ManyToOne(() => Shipment, { nullable: true })
  @JoinColumn({ name: 'shipmentId' })
  shipment: Shipment | null;

  @ManyToOne(() => ChargeShipment, { nullable: true })
  @JoinColumn({ name: 'chargeShipmentId' })
  chargeShipment: ChargeShipment | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  addedAt: Date;
}
