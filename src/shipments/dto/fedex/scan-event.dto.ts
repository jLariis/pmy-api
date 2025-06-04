import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { AddressDto } from "./address.dto";

export class ScanLocationDto extends AddressDto {
  @ApiProperty({ type: [String] })
  streetLines: string[];

  @ApiProperty()
  postalCode: string;
}

export class ScanEventDto {
  @ApiProperty()
  date: string;

  @ApiProperty()
  eventType: string;

  @ApiProperty()
  eventDescription: string;

  @ApiProperty()
  exceptionCode: string;

  @ApiProperty()
  exceptionDescription: string;

  @ApiProperty()
  @Type(() => ScanLocationDto)
  scanLocation: ScanLocationDto;

  @ApiProperty()
  locationId: string;

  @ApiProperty()
  locationType: string;

  @ApiProperty()
  derivedStatusCode: string;

  @ApiProperty()
  derivedStatus: string;
}