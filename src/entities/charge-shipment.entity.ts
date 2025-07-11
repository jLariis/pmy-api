import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { Shipment } from "./shipment.entity";
import { Charge } from "./charge.entity";

@Entity('charge_shipment')
export class ChargeShipment extends Shipment {
    @Index()
    @ManyToOne(() => Charge, { nullable: true })
    @JoinColumn({ name: 'chargeId' })
    charge: Charge;
}