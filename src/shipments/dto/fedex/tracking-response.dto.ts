import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { OutputDto } from './output.dto';

export class TrackingResponseDto {
  @ApiProperty()
  transactionId: string;

  @ApiProperty()
  @Type(() => OutputDto)
  output: OutputDto;
}