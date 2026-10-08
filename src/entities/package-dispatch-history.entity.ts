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

  /**
   * Arreglo manual del superadmin ("Paquetes con problema" del cierre): estatus con el que ESTA
   * salida cierra la guía. Gana sobre la regla del día/ventana. No toca el estatus vivo.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  closureStatus: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  closureExceptionCode: string | null;

  /** Instante real del evento FedEx que respalda el arreglo. */
  @Column({ type: 'datetime', nullable: true })
  closureStatusAt: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  closureFixedById: string | null;

  @Column({ type: 'datetime', nullable: true })
  closureFixedAt: Date | null;
}
