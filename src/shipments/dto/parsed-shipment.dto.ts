import { Priority } from "src/common/enums/priority.enum";
import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";
import { Subsidiary } from "src/entities";

export class ParsedShipmentDto {
    trackingNumber: string;
    recipientName: string;
    recipientAddress: string;
    recipientCity: string;
    recipientZip: string;
    commitDate: string; 
    commitTime: string;
    recipientPhone: string;
    status?: ShipmentStatusType;
    payment?: string;
    priority?: Priority;
    consNumber?: string;
    isNotIndividualBilling?: boolean;
    subsidiary?: Subsidiary
}

