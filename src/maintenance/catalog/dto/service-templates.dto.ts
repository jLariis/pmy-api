import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';

export class ServiceTemplateItemDto {
  @IsUUID('all', { message: 'Elige la pieza o insumo' })
  categoryId: string;

  @IsNumber({}, { message: 'La cantidad debe ser un número' }) @Min(0.01, { message: 'La cantidad debe ser mayor a 0' })
  quantity: number;

  @IsOptional() @ValidateIf((o) => o.unitId !== null) @IsUUID('all', { message: 'Presentación no válida' })
  unitId?: string | null;
}

export class ServiceTemplateDto {
  @IsString({ message: 'Escribe el nombre del servicio' })
  @MinLength(3, { message: 'Escribe el nombre del servicio' })
  @MaxLength(150, { message: 'El nombre es demasiado largo' })
  name: string;

  @IsOptional() @ValidateIf((o) => o.description !== null) @IsString() @MaxLength(2000, { message: 'La descripción es demasiado larga' })
  description?: string | null;

  @IsOptional() @ValidateIf((o) => o.vehicleType !== null) @IsString() @MaxLength(50)
  vehicleType?: string | null;

  @IsOptional() @ValidateIf((o) => o.keywords !== null) @IsString() @MaxLength(1000, { message: 'Demasiados sinónimos (máx. 1000 caracteres)' })
  keywords?: string | null;

  @IsOptional() @IsBoolean()
  active?: boolean;

  /** Receta opcional (piezas/insumos que lleva). */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ServiceTemplateItemDto)
  items?: ServiceTemplateItemDto[];
}
