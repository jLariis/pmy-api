import { ChargeShipment } from "src/entities/charge-shipment.entity"
import { Charge } from "src/entities/charge.entity"


export class ChargeWithStatusDto implements Partial<Charge> {
  id: string
  chargeDate: string
  numberOfPackages: number
  subsidiaryId: string | null
  isChargeComplete: boolean
  createdAt: string

  // Agregado
  shipments: ChargeShipment[]
}