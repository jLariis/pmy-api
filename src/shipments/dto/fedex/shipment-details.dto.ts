import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { WeightDto } from "./weight-and-dimensions.dto";

export class ShipmentDetailsDto {
  @ApiProperty()
  possessionStatus: boolean;

  @ApiProperty({ type: [WeightDto] })
  @Type(() => WeightDto)
  weight: WeightDto[];
}