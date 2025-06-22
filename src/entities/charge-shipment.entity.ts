import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import { Shipment } from "./shipment.entity";
import { Charge } from "./charge.entity";

@Entity('charge_shipment')
export class ChargeShipment extends Shipment {
    @ManyToOne(() => Charge, { nullable: true })
    @JoinColumn({ name: 'chargeId' })
    charge: Charge;

    @Column({ nullable: true })
    chargeId: string;

}