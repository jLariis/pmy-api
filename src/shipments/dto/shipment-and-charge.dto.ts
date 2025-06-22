import { Priority } from 'src/common/enums/priority.enum';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { Payment, ShipmentStatus, Subsidiary } from 'src/entities';

export class ShipmentAndChargeDto {
    id: string;
    trackingNumber: string;
    shipmentType: string; 
    recipientName: string;
    recipientAddress: string;
    recipientCity: string;
    recipientZip: string;
    commitDate: string;
    commitTime: string;
    recipientPhone: string;
    status: ShipmentStatusType;
    priority: Priority;
    payment: Payment;
    statusHistory: ShipmentStatus[];
    consNumber: string;
    receivedByName: string;
    subsidiaryId: string; // o toda la sucursal?
    isChargePackage?: boolean;
    chargeId?: string; // o  todo el objeto de carga?
    createdAt: string;
}