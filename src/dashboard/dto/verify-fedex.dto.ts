import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/**
 * Cuerpo de `POST /dashboard/welcome/verify-fedex`. Lista de guías a re-verificar
 * contra FedEx (read-only). Cap a 200 para acotar la ráfaga al endpoint batch.
 */
export class VerifyFedexDto {
  @ApiProperty({ type: [String], description: 'Guías a re-verificar (máx. 200).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  trackingNumbers: string[];
}
