import { ApiProperty } from "@nestjs/swagger";

export class TrackingNumberInfoDto {
  @ApiProperty()
  trackingNumber: string;

  @ApiProperty()
  trackingNumberUniqueId: string;

  @ApiProperty()
  carrierCode: string;
}