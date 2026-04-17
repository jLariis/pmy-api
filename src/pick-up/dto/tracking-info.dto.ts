import { Priority } from "src/common/enums/priority.enum";
import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";
import { ShipmentType } from "src/common/enums/shipment-type.enum";
import { Shipment, ShipmentStatus } from "src/entities";

export class TrackingInfoDto {
    carrierCode: string;
    commitDateTime: Date;
    consNumber: string;
    consolidatedId: string;
    fedexUniqueId: string;
    id: string;
    isHighValue: boolean;
    priority: Priority;
    receivedByName: string;
    recipientAddress: string;
    recipientCity: string;
    recipientName: string;
    recipientPhone: string;
    recipientZip: string;
    shipmentType: ShipmentType;
    status: ShipmentStatusType;
    trackingNumber: string;
    isCharge: boolean;
}