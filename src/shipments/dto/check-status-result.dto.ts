import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

class UpdatedShipmentDto {
  @IsString()
  trackingNumber: string;

  @IsString()
  fromStatus: string;

  @IsString()
  toStatus: string;

  @IsString()
  eventDate: string;

  @IsString()
  shipmentId: string;

  @IsOptional()
  @IsString()
  consolidatedId?: string;

  @IsOptional()
  @IsString()
  subsidiaryId?: string;
}

class ShipmentWithErrorDto {
  @IsString()
  trackingNumber: string;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;
}

class UnusualCodeDto {
  @IsString()
  trackingNumber: string;

  @IsString()
  derivedCode: string;

  @IsOptional()
  @IsString()
  exceptionCode?: string;

  @IsString()
  eventDate: string;

  @IsOptional()
  @IsString()
  statusByLocale?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;
}

class ShipmentWithODDto {
  @IsString()
  trackingNumber: string;

  @IsString()
  eventDate: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;
}

class ShipmentWithInvalidIncomeDto {
  @IsString()
  trackingNumber: string;

  @IsString()
  eventDate: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;
}

class ForPickUpShipmentDto {
  @IsString()
  trackingNumber: string;

  @IsString()
  eventDate: string;

  @IsString()
  shipmentId: string;

  @IsOptional()
  @IsString()
  subsidiaryId?: string;

  @IsOptional()
  @IsString()
  consolidatedId?: string;
}

export class FedexTrackingResponseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatedShipmentDto)
  updatedShipments: UpdatedShipmentDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipmentWithErrorDto)
  shipmentsWithError: ShipmentWithErrorDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UnusualCodeDto)
  unusualCodes: UnusualCodeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipmentWithODDto)
  shipmentsWithOD: ShipmentWithODDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipmentWithInvalidIncomeDto)
  shipmentsWithInvalidIncome: ShipmentWithInvalidIncomeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ForPickUpShipmentDto)
  forPickUpShipments: ForPickUpShipmentDto[];
}