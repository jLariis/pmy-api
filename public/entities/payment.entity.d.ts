import { PaymentStatus } from '../common/enums/payment-status.enum';
import { Shipment } from './shipment.entity';
export declare class Payment {
    id: string;
    amount: number;
    status: PaymentStatus;
    shipment: Shipment;
}
