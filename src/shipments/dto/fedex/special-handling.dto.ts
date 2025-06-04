import { ApiProperty } from "@nestjs/swagger";

export class SpecialHandlingDto {
  @ApiProperty()
  type: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  paymentType: string;
}