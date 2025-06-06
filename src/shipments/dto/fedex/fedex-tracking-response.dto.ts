import { Type } from "class-transformer";
import { IsString, IsObject, ValidateNested } from "class-validator";

export class FedExTrackingOutputDto {
  completeTrackResults: FedExCompleteTrackResultDto[];
}

export class FedExCompleteTrackResultDto {
  trackingNumber: string;
  trackResults: FedExTrackResultDto[];
}

export class FedExTrackResultDto {
  trackingNumberInfo: FedExTrackingNumberInfoDto;
  additionalTrackingInfo: FedExAdditionalTrackingInfoDto;
  shipperInformation: FedExPartyInformationDto;
  recipientInformation: FedExPartyInformationDto;
  latestStatusDetail: FedExStatusDetailDto;
  dateAndTimes: FedExDateTimeDto[];
  availableImages: FedExAvailableImageDto[];
  specialHandlings: FedExSpecialHandlingDto[];
  packageDetails: FedExPackageDetailsDto;
  shipmentDetails: FedExShipmentDetailsDto;
  scanEvents: FedExScanEventDto[];
  availableNotifications: string[];
  deliveryDetails: FedExDeliveryDetailsDto;
  originLocation: FedExLocationDto;
  destinationLocation: FedExLocationDto;
  lastUpdatedDestinationAddress: FedExAddressDto;
  serviceCommitMessage: FedExServiceCommitMessageDto;
  serviceDetail: FedExServiceDetailDto;
  standardTransitTimeWindow: FedExTimeWindowDto;
  estimatedDeliveryTimeWindow: FedExEstimatedTimeWindowDto;
  goodsClassificationCode: string;
  returnDetail: Record<string, unknown>;
}

// Sub-DTOs

export class FedExTrackingNumberInfoDto {
  trackingNumber: string;
  trackingNumberUniqueId: string;
  carrierCode: string;
}

export class FedExAdditionalTrackingInfoDto {
  nickname: string;
  packageIdentifiers: FedExPackageIdentifierDto[];
  hasAssociatedShipments: boolean;
}

export class FedExPackageIdentifierDto {
  type: string;
  values: string[];
  trackingNumberUniqueId: string;
  carrierCode: string;
}

export class FedExPartyInformationDto {
  contact: Record<string, unknown>;
  address: FedExAddressDto;
}

export class FedExAddressDto {
  city: string;
  stateOrProvinceCode: string;
  countryCode: string;
  residential: boolean;
  countryName: string;
  postalCode?: string;
  streetLines?: string[];
}

export class FedExStatusDetailDto {
  code: string;
  derivedCode: string;
  statusByLocale: string;
  description: string;
  scanLocation: FedExAddressDto;
  ancillaryDetails?: FedExAncillaryDetailDto[];
}

export class FedExAncillaryDetailDto {
  reason: string;
  reasonDescription: string;
  action: string;
  actionDescription: string;
}

export class FedExDateTimeDto {
  type: string;
  dateTime: string;
}

export class FedExAvailableImageDto {
  type: string;
}

export class FedExSpecialHandlingDto {
  type: string;
  description: string;
  paymentType: string;
}

export class FedExPackageDetailsDto {
  packagingDescription: FedExPackagingDescriptionDto;
  sequenceNumber: string;
  count: string;
  weightAndDimensions: FedExWeightAndDimensionsDto;
  packageContent: unknown[];
}

export class FedExPackagingDescriptionDto {
  type: string;
  description: string;
}

export class FedExWeightAndDimensionsDto {
  weight?: FedExWeightDto[];
  dimensions?: FedExDimensionDto[];
}

export class FedExWeightDto {
  value: string;
  unit: string;
}

export class FedExDimensionDto {
  length: number;
  width: number;
  height: number;
  units: string;
}

export class FedExShipmentDetailsDto {
  possessionStatus: boolean;
  weight: FedExWeightDto[];
}

export class FedExScanEventDto {
  date: string;
  eventType: string;
  eventDescription: string;
  exceptionCode: string;
  exceptionDescription: string;
  scanLocation: FedExAddressDto;
  locationId: string;
  locationType: string;
  derivedStatusCode: string;
  derivedStatus: string;
}

export class FedExDeliveryDetailsDto {
  deliveryAttempts?: string;
  receivedByName?: string;
  destinationServiceArea?: string;
  deliveryOptionEligibilityDetails?: FedExDeliveryOptionEligibilityDto[];
}

export class FedExDeliveryOptionEligibilityDto {
  option: string;
  eligibility: string;
}

export class FedExLocationDto {
  locationContactAndAddress?: {
    address: FedExAddressDto;
  };
  locationId?: string;
  locationType?: string;
}

export class FedExServiceCommitMessageDto {
  message: string;
  type: string;
}

export class FedExServiceDetailDto {
  type: string;
  description: string;
  shortDescription: string;
}

export class FedExTimeWindowDto {
  window: {
    begins?: string;
    ends?: string;
  };
}

export class FedExEstimatedTimeWindowDto extends FedExTimeWindowDto {
  type: string;
}

export class FedExTrackingResponseDto {
  @IsString()
  transactionId: string;

  @IsObject()
  @ValidateNested()
  @Type(() => FedExTrackingOutputDto)
  output: FedExTrackingOutputDto;
}