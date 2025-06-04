import { ApiProperty } from "@nestjs/swagger";

export class AddressDto {
  @ApiProperty()
  city: string;

  @ApiProperty()
  stateOrProvinceCode: string;

  @ApiProperty()
  countryCode: string;

  @ApiProperty()
  residential: boolean;

  @ApiProperty()
  countryName: string;
}