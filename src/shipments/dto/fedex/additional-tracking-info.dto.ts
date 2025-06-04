import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { PackageIdentifierDto } from "./package-identifier.dto";

export class AdditionalTrackingInfoDto {
  @ApiProperty()
  nickname: string;

  @ApiProperty({ type: [PackageIdentifierDto] })
  @Type(() => PackageIdentifierDto)
  packageIdentifiers: PackageIdentifierDto[];

  @ApiProperty()
  hasAssociatedShipments: boolean;
}