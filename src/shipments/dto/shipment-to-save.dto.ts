import { Priority } from "src/common/enums/priority.enum";
import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";
import { ShipmentType } from "src/common/enums/shipment-type.enum";
import { Payment, Subsidiary } from "src/entities";

export class ShipmentToSaveDto {
    trackingNumber: string;
    recipientName: string;
    recipientAddress: string;
    recipientCity: string;
    recipientZip: string;
    commitDate: string; 
    commitTime: string;
    recipientPhone: string;
    status?: ShipmentStatusType;
    shipmentType: ShipmentType;
    payment?: string;
    priority?: Priority;
    consNumber?: string;
    subsidiary?: Subsidiary;
    isHighValue?: boolean;
}