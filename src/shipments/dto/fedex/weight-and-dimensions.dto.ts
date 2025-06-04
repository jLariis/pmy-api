import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";

export class WeightDto {
  @ApiProperty()
  value: string;

  @ApiProperty()
  unit: string;
}

export class DimensionDto {
  @ApiProperty()
  length: number;

  @ApiProperty()
  width: number;

  @ApiProperty()
  height: number;

  @ApiProperty()
  units: string;
}


export class WeightAndDimensionsDto {
  @ApiProperty({ type: [WeightDto] })
  @Type(() => WeightDto)
  weight: WeightDto[];

  @ApiProperty({ type: [DimensionDto] })
  @Type(() => DimensionDto)
  dimensions: DimensionDto[];
}
