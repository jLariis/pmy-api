import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";

export class ValidateShipmentDto {
  id: string;
  trackingNumber: string;
  status: string;
  subsidiaryId: string;    // Nuevo campo
  subsidiaryName: string;  // Existente
  hasIncome: boolean;
  isCharge: boolean;
  hasError?: boolean;
  errorMessage?: string;
  lastStatus: {
    type: string | null;
    exceptionCode: string | null;
    notes: string | null;
  } | null;
}