import { ChargeShipment } from "src/entities/charge-shipment.entity"
import { Charge } from "src/entities/charge.entity"


export class ChargeWithStatusDto implements Partial<Charge> {
  id: string
  chargeDate: Date
  numberOfPackages: number
  //subsidiaryId: string | null
  isChargeComplete: boolean
  createdAt: Date

  // Agregado
  shipments: ChargeShipment[]
}