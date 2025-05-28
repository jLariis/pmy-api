import { Payment } from './payment.entity';
import { ShipmentStatus } from './shipment-status.entity';
import { Priority } from '../common/enums/priority.enum';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';
export declare class Shipment {
    id: string;
    trackingNumber: string;
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
}
