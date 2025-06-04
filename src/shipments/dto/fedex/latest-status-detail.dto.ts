import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { AddressDto } from "./address.dto";
import { AncillaryDetailDto } from "./ancillar-detail.dto";

export class LatestStatusDetailDto {
  @ApiProperty()
  code: string;

  @ApiProperty()
  derivedCode: string;

  @ApiProperty()
  statusByLocale: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  @Type(() => AddressDto)
  scanLocation: AddressDto;

  @ApiProperty({ type: [AncillaryDetailDto] })
  @Type(() => AncillaryDetailDto)
  ancillaryDetails: AncillaryDetailDto[];
}