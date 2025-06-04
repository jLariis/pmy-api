import { ApiProperty } from "@nestjs/swagger";

export class AncillaryDetailDto {
  @ApiProperty()
  reason: string;

  @ApiProperty()
  reasonDescription: string;

  @ApiProperty()
  action: string;

  @ApiProperty()
  actionDescription: string;
}