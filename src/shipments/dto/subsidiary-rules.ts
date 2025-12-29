import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";

export interface SubsidiaryRules {
  allowedExceptionCodes: string[];
  allowedStatuses: ShipmentStatusType[];
  maxEventAgeDays?: number;
  allowDuplicateStatuses?: boolean;
  allowedEventTypes?: string[];
  noIncomeExceptionCodes?: string[];
  notFoundExceptionCodes?: string[];
  minEvents08?: number; // Minimum events for exceptionCode 08
  allowException03?: boolean; // Allow income for exceptionCode 03
  allowException16?: boolean; // Allow income for exceptionCode 16
  allowExceptionOD?: boolean; // Allow income for exceptionCode OD
  allowIncomeFor07?: boolean; // Allow income for exceptionCode 07,
  allowIncomeFor67?: boolean;
  alwaysProcess67?: boolean,
}