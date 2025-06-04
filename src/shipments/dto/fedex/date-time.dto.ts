import { ApiProperty } from "@nestjs/swagger";

export class DateAndTimeDto {
  @ApiProperty()
  type: string;

  @ApiProperty()
  dateTime: string;
}