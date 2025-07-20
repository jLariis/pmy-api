import { IsArray, ArrayNotEmpty, IsString, IsOptional, IsBoolean } from "class-validator";
import { ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";

export interface ShipmentStatusChange {
  trackingNumber: string;
  oldStatus: ShipmentStatusType | null;
  newStatus: ShipmentStatusType;
  eventDate: string;
  exceptionCode?: string;
}

export interface ShipmentCheckResult {
  updatedShipments: ShipmentStatusChange[];
  unusualCodes: {
    trackingNumber: string;
    derivedCode: string;
    exceptionCode?: string;
    eventDate: string;
    statusByLocale?: string;
  }[];
  shipmentsWithError: {
    trackingNumber: string;
    reason: string;
  }[];
  shipmentsWithOD: {
    trackingNumber: string;
    eventDate: string;
  }[];
}

export class CheckFedexStatusDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  trackingNumbers: string[];

  @IsOptional()
  @IsBoolean()
  shouldPersist?: boolean;
}