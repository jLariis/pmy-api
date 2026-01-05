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
}
