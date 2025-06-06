import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { AdditionalTrackingInfoDto } from "./additional-tracking-info.dto";
import { DateAndTimeDto } from "./date-time.dto";
import { LatestStatusDetailDto } from "./latest-status-detail.dto";
import { PackageDetailsDto } from "./package-detail.dto";
import { PartyInformationDto } from "./party-info.dto";
import { ScanEventDto } from "./scan-event.dto";
import { ShipmentDetailsDto } from "./shipment-details.dto";
import { SpecialHandlingDto } from "./special-handling.dto";
import { TrackingNumberInfoDto } from "./tracking-number-info.dto";

export class TrackResultDto {
  @ApiProperty()
  @Type(() => TrackingNumberInfoDto)
  trackingNumberInfo: TrackingNumberInfoDto;

  @ApiProperty()
  @Type(() => AdditionalTrackingInfoDto)
  additionalTrackingInfo: AdditionalTrackingInfoDto;

  @ApiProperty()
  @Type(() => PartyInformationDto)
  shipperInformation: PartyInformationDto;

  @ApiProperty()
  @Type(() => PartyInformationDto)
  recipientInformation: PartyInformationDto;

  @ApiProperty()
  @Type(() => LatestStatusDetailDto)
  latestStatusDetail: LatestStatusDetailDto;

  @ApiProperty({ type: [DateAndTimeDto] })
  @Type(() => DateAndTimeDto)
  dateAndTimes: DateAndTimeDto[];

  @ApiProperty({ type: [SpecialHandlingDto] })
  @Type(() => SpecialHandlingDto)
  specialHandlings: SpecialHandlingDto[];

  @ApiProperty()
  @Type(() => PackageDetailsDto)
  packageDetails: PackageDetailsDto;

  @ApiProperty()
  @Type(() => ShipmentDetailsDto)
  shipmentDetails: ShipmentDetailsDto;

  @ApiProperty({ type: [ScanEventDto] })
  @Type(() => ScanEventDto)
  scanEvents: ScanEventDto[];

  @ApiProperty({ type: [String] })
  availableImages: string[];

  @ApiProperty({ type: String })
  deliveryDetails: {
    receivedByName: string;
  }

  @ApiProperty()
  standardTransitTimeWindow: {
    window: {
      ends: string
    }
  }
}