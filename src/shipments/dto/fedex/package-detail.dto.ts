import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { PackagingDescriptionDto } from "./packaing-description.dto";
import { WeightAndDimensionsDto } from "./weight-and-dimensions.dto";

export class PackageDetailsDto {
  @ApiProperty()
  @Type(() => PackagingDescriptionDto)
  packagingDescription: PackagingDescriptionDto;

  @ApiProperty()
  sequenceNumber: string;

  @ApiProperty()
  count: string;

  @ApiProperty()
  @Type(() => WeightAndDimensionsDto)
  weightAndDimensions: WeightAndDimensionsDto;

  @ApiProperty({ type: [String] })
  packageContent: string[];
}