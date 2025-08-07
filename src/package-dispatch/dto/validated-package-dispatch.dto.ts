import { Priority } from "src/common/enums/priority.enum"
import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum"
import { Consolidated, Subsidiary, Charge, Shipment, Payment } from "src/entities"

export class ValidatedPackageDispatchDto {
    trackingNumber: string
    commitDateTime?: Date
    consNumber?: string
    consolidated?: Consolidated
    isHighValue?: boolean
    priority?: Priority
    recipientAddress?: string
    recipientCity?: string
    recipientName?: string
    recipientPhone?: string
    recipientZip?: string
    shipmentType?: string
    subsidiary?: Subsidiary
    status?: ShipmentStatusType
    isCharge?: boolean
    charge?: Charge
    isValid: boolean
    reason?: string
    payment?: Payment
}