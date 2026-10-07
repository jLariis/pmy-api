import { Priority } from "src/common/enums/priority.enum";
import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";
import { Payment, Subsidiary } from "src/entities";
import { CommitIssue } from "src/utils/commit-date.util";

export class ParsedShipmentDto {
    trackingNumber: string;
    recipientName: string;
    recipientAddress: string;
    recipientCity: string;
    recipientZip: string;
    commitDate: string; 
    commitTime: string;
    /** Problema al leer el vencimiento del archivo (para avisar en la vista previa). */
    commitIssue?: CommitIssue | null;
    recipientPhone: string;
    status?: ShipmentStatusType;
    payment?: string;
    priority?: Priority;
    consNumber?: string;
    isPartOfCharge?: boolean;
    subsidiary?: Subsidiary
}

