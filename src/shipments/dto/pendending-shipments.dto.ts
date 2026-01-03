import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsDateString } from 'class-validator';

export class PendingShipmentsQueryDto {
  @ApiPropertyOptional({
    description: 'ID de la sucursal',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6'
  })
  @IsOptional()
  @IsString()
  subsidiaryId?: string;

  @ApiPropertyOptional({
    description: 'Fecha inicio (YYYY-MM-DD)',
    example: '2024-12-01'
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Fecha fin (YYYY-MM-DD)',
    example: '2024-12-31'
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
