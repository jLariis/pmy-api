import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
export declare class CreateShipmentDto {
    trackingNumber: string;
    recipientName: string;
    recipientAddress: string;
    recipientCity: string;
    recipientZip: string;
    commitDate: Date;
    commitTime: string;
    recipientPhone: string;
    status: ShipmentStatusType;
    payment: any;
    priority: 'alta' | 'media' | 'baja';
    statusHistory: {
        status: ShipmentStatusType;
        timestamp: string;
        notes: string;
    }[];
}
