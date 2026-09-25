import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { PRODUCT_KINDS, ProductKind } from 'src/entities/product-category.entity';

const NAME = (what: string) => ({ message: `Escribe el nombre ${what}` });

export class UnitDto {
  @IsString(NAME('de la presentación')) @MinLength(1, NAME('de la presentación')) @MaxLength(60, { message: 'El nombre es demasiado largo' })
  name: string;

  @IsOptional() @IsString() @MaxLength(15, { message: 'La abreviatura es demasiado larga (máx. 15)' })
  abbreviation?: string | null;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class ProductCategoryDto {
  @IsString(NAME('')) @MinLength(2, NAME('')) @MaxLength(120, { message: 'El nombre es demasiado largo' })
  name: string;

  @IsIn(PRODUCT_KINDS as unknown as string[], { message: 'Tipo no válido (pieza, insumo, servicio o equipo)' })
  kind: ProductKind;

  @IsOptional() @IsInt({ message: 'El orden debe ser un número entero' })
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class OfferDto {
  @IsOptional() @IsUUID('all')
  id?: string;

  @IsUUID('all', { message: 'Elige el proveedor' })
  supplierId: string;

  @IsOptional() @ValidateIf((o) => o.unitId !== null) @IsUUID('all', { message: 'Presentación no válida' })
  unitId?: string | null;

  @IsNumber({}, { message: 'El precio debe ser un número' }) @Min(0, { message: 'El precio no puede ser negativo' })
  price: number;

  @IsOptional() @ValidateIf((o) => o.quality !== null)
  @IsInt({ message: 'La calidad va de 1 a 5 estrellas' }) @Min(1, { message: 'La calidad va de 1 a 5 estrellas' }) @Max(5, { message: 'La calidad va de 1 a 5 estrellas' })
  quality?: number | null;
}

export class ProductDto {
  @IsString(NAME('del producto')) @MinLength(2, NAME('del producto')) @MaxLength(200, { message: 'El nombre es demasiado largo' })
  name: string;

  @IsOptional() @IsString()
  description?: string | null;

  @IsOptional() @ValidateIf((o) => o.categoryId !== null) @IsUUID('all', { message: 'Elige la categoría (pieza o insumo)' })
  categoryId?: string | null;

  @IsOptional() @IsString() @MaxLength(100, { message: 'La marca es demasiado larga' })
  brand?: string | null;

  @IsOptional() @IsString() @MaxLength(100, { message: 'El número de parte es demasiado largo' })
  partNumber?: string | null;

  @IsOptional() @ValidateIf((o) => o.unitId !== null) @IsUUID('all', { message: 'Elige la unidad de medida' })
  unitId?: string | null;

  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OfferDto)
  offers?: OfferDto[];
}
