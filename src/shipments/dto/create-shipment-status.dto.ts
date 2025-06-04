import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";
import { Shipment } from "src/entities";

export class ShipmentStatusDto {
    shipment: Shipment
    status: ShipmentStatusType;
    timestamp: string;
    notes?: string;
}