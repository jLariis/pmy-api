import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Referencia por id (unidad / sucursal). Antes se recibían las ENTIDADES completas del cliente
 * y se guardaban tal cual; ahora solo cuenta el id (el nombre es informativo y se ignora).
 */
export class IdRefDto {
  @IsString({ message: 'El id no es válido.' })
  @IsNotEmpty({ message: 'Falta el id.' })
  @MaxLength(64)
  id: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class CreateUnloadingDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => IdRefDto)
  vehicle?: IdRefDto;

  @ValidateNested({ message: 'Falta la sucursal.' })
  @Type(() => IdRefDto)
  subsidiary: IdRefDto;

  @IsArray({ message: 'La lista de guías no es válida.' })
  @ArrayMaxSize(5000, { message: 'Son demasiadas guías para un solo desembarque.' })
  @IsString({ each: true })
  shipments: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  missingTrackings?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  unScannedTrackings?: string[];

  /** Informativo: el servidor usa su propia hora. */
  @IsOptional()
  @IsString()
  date?: string;

  /** Folio único de la captura (lo genera el front): evita duplicar si se manda dos veces. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'El folio de captura no es válido.' })
  clientRequestId?: string;
}
