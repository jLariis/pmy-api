import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

export class CreateShipmentDto {
  trackingNumber: string;
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientZip: string;
  commitDate: Date;
  commitTime: string;
  recipientPhone: string;
  status: ShipmentStatusType; // aquí el cambio
  payment: any;
  priority: 'alta' | 'media' | 'baja';
  statusHistory: {
    status: ShipmentStatusType;
    timestamp: string;
    notes: string;
  }[];
}