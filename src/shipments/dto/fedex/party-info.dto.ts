import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { AddressDto } from "./address.dto";

export class PartyInformationDto {
  @ApiProperty()
  contact: Record<string, any>; // Puedes cambiarlo por una interfaz si tienes más datos

  @ApiProperty()
  @Type(() => AddressDto)
  address: AddressDto;
}
