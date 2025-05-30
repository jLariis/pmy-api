import { Priority } from 'src/common/enums/priority.enum';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

export class ShipmentDto {
  trackingNumber: string;
    recipientName: string;
    recipientAddress: string;
    recipientCity: string;
    recipientZip: string;
    commitDate: Date;
    commitTime: string;
    recipientPhone: string;
    status: ShipmentStatusType;
    priority: Priority;
}