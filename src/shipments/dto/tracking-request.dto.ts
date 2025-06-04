import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class TrackRequestDto {
  @ApiPropertyOptional({
    description: 'Un solo número de rastreo',
    example: '1234567890',
  })
  @ValidateIf((o) => !o.trackingNumbers || o.trackingNumbers.length === 0)
  @IsString()
  trackingNumber?: string;

  @ApiPropertyOptional({
    description: 'Lista de números de rastreo',
    example: ['1234567890', '0987654321'],
    isArray: true,
    type: String,
  })
  @ValidateIf((o) => !o.trackingNumber)
  @IsArray()
  @Type(() => String)
  trackingNumbers?: string[];
}