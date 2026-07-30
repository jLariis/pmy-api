import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

/**
 * Body del endpoint batch de validación de salidas a ruta. Valida toda la lista
 * escaneada en un solo request y devuelve los paquetes ordenados según la config
 * de la sucursal (`sortDispatchByPostalCode`).
 */
export class ValidateTrackingsDto {
  @ApiProperty({ type: [String], example: ['794613...', 'JD0142...'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  trackingNumbers: string[];

  @ApiProperty({ example: '6076326c-f6f6-4004-825d-5419a4e6412f' })
  @IsString()
  subsidiaryId: string;
}
