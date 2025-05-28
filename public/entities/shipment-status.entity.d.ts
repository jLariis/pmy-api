import { Shipment } from './shipment.entity';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';
export declare class ShipmentStatus {
    id: string;
    shipment: Shipment;
    status: ShipmentStatusType;
    timestamp: string;
    notes?: string;
}
