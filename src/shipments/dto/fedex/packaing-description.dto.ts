import { ApiProperty } from "@nestjs/swagger";

export class PackagingDescriptionDto {
  @ApiProperty()
  type: string;

  @ApiProperty()
  description: string;
}