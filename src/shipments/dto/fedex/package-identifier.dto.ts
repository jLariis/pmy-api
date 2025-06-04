import { ApiProperty } from "@nestjs/swagger";

export class PackageIdentifierDto {
  @ApiProperty()
  type: string;

  @ApiProperty({ type: [String] })
  values: string[];

  @ApiProperty()
  trackingNumberUniqueId: string;

  @ApiProperty()
  carrierCode: string;
}