import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';

const MAX_PER_LIST = 2000;
const CAUSES = [
  'NO_EXISTE', 'OTRA_SUCURSAL', 'SIN_CONSOLIDADO', 'SIN_RUTA', 'RUTA_OTRO_DIA', 'ESTATUS_DESFASADO',
  'COBRO_DE_MAS', 'COBRO_FALTANTE', 'INGRESO_OTRO_DIA', 'DUPLICADO', 'MONTO_INCORRECTO',
  'ERROR_CONTEO', 'REGLA_NO_COBRA', 'F2_INFORMATIVO',
];

export class ManualCountFedexDto {
  @IsArray({ message: 'Envía la lista de guías.' })
  @ArrayMinSize(1, { message: 'Envía al menos una guía.' })
  @ArrayMaxSize(25, { message: 'Se consultan máximo 25 guías por bloque.' })
  @IsString({ each: true, message: 'Cada guía debe ser texto.' })
  trackingNumbers: string[];
}

export class ManualCountDto {
  @IsArray({ message: 'La lista de POD no es válida.' })
  @ArrayMaxSize(MAX_PER_LIST, { message: `Máximo ${MAX_PER_LIST} guías en POD.` })
  @IsString({ each: true, message: 'Cada guía de POD debe ser texto.' })
  pod: string[];

  @IsArray({ message: 'La lista de DEX07 no es válida.' })
  @ArrayMaxSize(MAX_PER_LIST, { message: `Máximo ${MAX_PER_LIST} guías en DEX07.` })
  @IsString({ each: true, message: 'Cada guía de DEX07 debe ser texto.' })
  dex07: string[];

  @IsArray({ message: 'La lista de DEX08 no es válida.' })
  @ArrayMaxSize(MAX_PER_LIST, { message: `Máximo ${MAX_PER_LIST} guías en DEX08.` })
  @IsString({ each: true, message: 'Cada guía de DEX08 debe ser texto.' })
  dex08: string[];
}

export class ManualCountPromptDto extends ManualCountDto {
  @IsOptional()
  @IsArray({ message: 'Las causas no son válidas.' })
  @IsIn(CAUSES, { each: true, message: 'Hay una causa que no existe.' })
  causes?: string[];
}
