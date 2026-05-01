import { PaymentTypeEnum } from "src/common/enums/payment-type.enum";
import { Priority } from "src/common/enums/priority.enum";
import { ShipmentType } from "src/common/enums/shipment-type.enum";
import { Subsidiary } from "src/entities";

export class ScannedShipment {
  id: string;
  trackingNumber: string;
  shipmentType: ShipmentType;
  recipientZip: string;
  subsidiary: Subsidiary | null;
  commitDateTime: Date;
  isHighValue: boolean;
  priority: Priority;
  status: string;
  isCharge: boolean;
  hasPayment: boolean;
  paymentAmount: number;
  paymentType: PaymentTypeEnum
};