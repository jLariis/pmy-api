import { Type } from "class-transformer";
import { 
  IsString, 
  IsObject, 
  ValidateNested, 
  IsArray, 
  IsBoolean, 
  IsOptional, 
  IsNumber
} from "class-validator";

// -------------------------------------------------------------------------
// 1. NIVEL BASE (Clases que no dependen de nadie o solo de primitivos)
// -------------------------------------------------------------------------

// NOTA: FedEx omite la mayoría de estos campos según el estado del paquete
// (errores, label-only, direcciones parciales). Todo es opcional salvo lo que
// la API garantiza. El consumidor usa optional-chaining acorde a esta realidad.
export class FedExAddressDto {
  @IsOptional() @IsArray() @IsString({ each: true }) streetLines?: string[];
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() stateOrProvinceCode?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsString() countryName?: string;
  @IsOptional() @IsBoolean() residential?: boolean;
  @IsOptional() @IsString() addressClassification?: string;
}

export class FedExWeightDto {
  @IsString() value: string;
  @IsString() unit: string;
}

export class FedExDimensionDto {
  @IsNumber() length: number;
  @IsNumber() width: number;
  @IsNumber() height: number;
  @IsString() units: string;
}

export class FedExPackagingDescriptionDto {
  @IsString() type: string;
  @IsString() description: string;
}

export class FedExShipmentContentDto {
  @IsString() itemNumber: string;
  @IsString() description: string;
  @IsString() partNumber: string;
  @IsString() receivedQuantity: string;
}

export class FedExAncillaryDetailDto {
  @IsString() reason: string;
  @IsString() reasonDescription: string;
  @IsString() action: string;
  @IsString() actionDescription: string;
}

export class FedExPackageIdentifierDto {
  @IsString() type: string;
  @IsString() value: string;
  @IsString() trackingNumberUniqueId: string;
}

export class FedExTrackingNumberInfoDto {
  @IsString() trackingNumber: string; // único garantizado
  @IsOptional() @IsString() trackingNumberUniqueId?: string;
  @IsOptional() @IsString() carrierCode?: string;
}

export class FedExDateTimeDto {
  @IsString() type: string;
  @IsString() dateTime: string;
}

export class FedExDeliveryOptionEligibilityDto {
  @IsString() option: string;
  @IsString() eligibility: string;
}

export class FedExServiceCommitMessageDto {
  @IsString() message: string;
  @IsString() type: string;
}

export class FedExServiceDetailDto {
  @IsString() type: string;
  @IsString() description: string;
  @IsString() shortDescription: string;
}

export class FedExTimeWindowDto {
  @IsObject()
  window: {
    begins?: string;
    ends?: string;
  };
}

export class FedExEstimatedTimeWindowDto extends FedExTimeWindowDto {
  @IsString() type: string;
}

// -------------------------------------------------------------------------
// 2. NIVEL INTERMEDIO (Clases que dependen del Nivel 1)
// -------------------------------------------------------------------------

// MOVIDO ARRIBA: Ahora está antes de FedExLocationDto
export class FedExLocationContactAndAddressDto {
  @ValidateNested() @Type(() => FedExAddressDto)
  address: FedExAddressDto;
}

export class FedExLocationDto {
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() locationType?: string;
  
  // Ahora sí funcionará porque FedExLocationContactAndAddressDto ya fue leída arriba
  @IsOptional() @ValidateNested() @Type(() => FedExLocationContactAndAddressDto)
  locationContactAndAddress?: FedExLocationContactAndAddressDto;
}

export class FedExWeightAndDimensionsDto {
  @IsOptional() @ValidateNested({ each: true }) @Type(() => FedExWeightDto)
  weight?: FedExWeightDto[];
  @IsOptional() @ValidateNested({ each: true }) @Type(() => FedExDimensionDto)
  dimensions?: FedExDimensionDto[];
}

export class FedExDeliveryDetailsDto {
  @IsOptional() @IsString() deliveryAttempts?: string;
  @IsOptional() @IsString() receivedByName?: string;
  // `signedByName` = QUIÉN FIRMÓ la entrega (no el destinatario ordenado).
  @IsOptional() @IsString() signedByName?: string;
  @IsOptional() @IsString() destinationServiceArea?: string;
  @IsOptional() @IsString() destinationServiceAreaDescription?: string;
  @IsOptional() @IsString() locationDescription?: string;
  @IsOptional() @IsString() locationType?: string;
  @IsOptional() @IsString() officeOrderDeliveryMethod?: string;
  @IsOptional() @IsBoolean() deliveryToday?: boolean;
  @IsOptional() @ValidateNested() @Type(() => FedExAddressDto)
  actualDeliveryAddress?: FedExAddressDto;
  @IsOptional() @ValidateNested({ each: true }) @Type(() => FedExDeliveryOptionEligibilityDto)
  deliveryOptionEligibilityDetails?: FedExDeliveryOptionEligibilityDto[];
}

export class FedExStatusDetailDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() derivedCode?: string;
  @IsOptional() @IsString() statusByLocale?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @ValidateNested() @Type(() => FedExAddressDto)
  scanLocation?: FedExAddressDto;
  @IsOptional() @ValidateNested({ each: true }) @Type(() => FedExAncillaryDetailDto)
  ancillaryDetails?: FedExAncillaryDetailDto[];
}

export class FedExScanEventDto {
  @IsString() date: string;
  @IsString() eventType: string;
  @IsString() eventDescription: string;
  @IsOptional() @IsString() exceptionCode?: string;
  @IsOptional() @IsString() exceptionDescription?: string;
  @IsOptional() @ValidateNested() @Type(() => FedExAddressDto)
  scanLocation?: FedExAddressDto;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() locationType?: string;
  @IsOptional() @IsString() derivedStatusCode?: string;
  @IsOptional() @IsString() derivedStatus?: string;
}

export class FedExAdditionalTrackingInfoDto {
  @IsString() nickname: string;
  @IsBoolean() hasAssociatedShipments: boolean;
  @ValidateNested({ each: true }) @Type(() => FedExPackageIdentifierDto)
  packageIdentifiers: FedExPackageIdentifierDto[];
}

export class FedExShipmentDetailsDto {
  @IsBoolean() beforePossessionStatus: boolean;
  @IsString() contentPieceCount: string;
  @ValidateNested({ each: true }) @Type(() => FedExWeightDto)
  weight: FedExWeightDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FedExShipmentContentDto)
  contents?: FedExShipmentContentDto[];
}

// -------------------------------------------------------------------------
// 3. NIVEL AVANZADO (Dependen del Nivel 2)
// -------------------------------------------------------------------------

export class FedExPackageDetailsDto {
  @ValidateNested() @Type(() => FedExPackagingDescriptionDto)
  packagingDescription: FedExPackagingDescriptionDto;
  @IsString() sequenceNumber: string;
  @IsString() count: string;
  @ValidateNested() @Type(() => FedExWeightAndDimensionsDto)
  weightAndDimensions: FedExWeightAndDimensionsDto;
  @IsArray() packageContent: string[];
  @IsOptional() @IsString() undeliveredCount?: string;
}

// -------------------------------------------------------------------------
// 4. CLASES PRINCIPALES (Los contenedores grandes)
// -------------------------------------------------------------------------

// Único campo garantizado por FedEx es `trackingNumberInfo`. Todo lo demás
// puede faltar (errores por guía, label-only, etc.) → opcional.
export class FedExTrackResultDto {
  @ValidateNested() @Type(() => FedExTrackingNumberInfoDto)
  trackingNumberInfo: FedExTrackingNumberInfoDto;

  @IsOptional() @ValidateNested() @Type(() => FedExAdditionalTrackingInfoDto)
  additionalTrackingInfo?: FedExAdditionalTrackingInfoDto;

  @IsOptional() @ValidateNested() @Type(() => FedExLocationContactAndAddressDto)
  shipperInformation?: FedExLocationContactAndAddressDto;

  @IsOptional() @ValidateNested() @Type(() => FedExLocationContactAndAddressDto)
  recipientInformation?: FedExLocationContactAndAddressDto;

  @IsOptional() @ValidateNested() @Type(() => FedExStatusDetailDto)
  latestStatusDetail?: FedExStatusDetailDto;

  @IsOptional() @ValidateNested({ each: true }) @Type(() => FedExDateTimeDto)
  dateAndTimes?: FedExDateTimeDto[];

  @IsOptional() @ValidateNested({ each: true }) @Type(() => FedExScanEventDto)
  scanEvents?: FedExScanEventDto[];

  @IsOptional() @ValidateNested() @Type(() => FedExPackageDetailsDto)
  packageDetails?: FedExPackageDetailsDto;

  @IsOptional() @ValidateNested() @Type(() => FedExShipmentDetailsDto)
  shipmentDetails?: FedExShipmentDetailsDto;

  @IsOptional() @ValidateNested() @Type(() => FedExServiceDetailDto)
  serviceDetail?: FedExServiceDetailDto;

  @IsOptional() @IsArray() @IsString({ each: true })
  availableNotifications?: string[];

  @IsOptional() @ValidateNested() @Type(() => FedExDeliveryDetailsDto)
  deliveryDetails?: FedExDeliveryDetailsDto;

  @IsOptional() @ValidateNested() @Type(() => FedExLocationDto)
  originLocation?: FedExLocationDto;

  @IsOptional() @ValidateNested() @Type(() => FedExLocationDto)
  destinationLocation?: FedExLocationDto;

  @IsOptional() @ValidateNested() @Type(() => FedExAddressDto)
  lastUpdatedDestinationAddress?: FedExAddressDto;

  @IsOptional() @ValidateNested() @Type(() => FedExServiceCommitMessageDto)
  serviceCommitMessage?: FedExServiceCommitMessageDto;

  @IsOptional() @ValidateNested() @Type(() => FedExTimeWindowDto)
  standardTransitTimeWindow?: FedExTimeWindowDto;

  @IsOptional() @ValidateNested() @Type(() => FedExEstimatedTimeWindowDto)
  estimatedDeliveryTimeWindow?: FedExEstimatedTimeWindowDto;

  @IsOptional() @IsString()
  goodsClassificationCode?: string;

  @IsOptional() @IsObject()
  error?: Record<string, any>;
}

export class FedExCompleteTrackResultDto {
  @IsString() trackingNumber: string;

  @ValidateNested({ each: true })
  @Type(() => FedExTrackResultDto)
  trackResults: FedExTrackResultDto[];
}

export class FedExTrackingOutputDto {
  @ValidateNested({ each: true })
  @Type(() => FedExCompleteTrackResultDto)
  completeTrackResults: FedExCompleteTrackResultDto[];

  @IsOptional() @IsString()
  alerts?: string;
}

export class FedExTrackingResponseDto {
  @IsString()
  transactionId: string;

  @IsString()
  customerTransactionId: string;

  @IsObject()
  @ValidateNested()
  @Type(() => FedExTrackingOutputDto)
  output: FedExTrackingOutputDto;
}