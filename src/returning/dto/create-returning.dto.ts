import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ReturningDevolutionItemDto {
  @IsString()
  @IsNotEmpty()
  trackingNumber: string;

  @IsOptional()
  @IsString()
  status?: string;

  /** Motivo (exceptionCode de FedEx). */
  @IsOptional()
  @IsString()
  reason?: string;

  /** El usuario confirmó anular el ingreso `entregado` de esta guía al devolverla (ver DTO base). */
  @IsOptional()
  @IsBoolean()
  annulEntregadoIncome?: boolean;
}

export class ReturningCollectionItemDto {
  @IsString()
  @IsNotEmpty()
  trackingNumber: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  isPickUp?: boolean;

  @IsOptional()
  @IsString()
  date?: string;
}

/**
 * Guardado unificado de una "Salida de Devoluciones y Recolecciones": crea el lote
 * (sucursal, chofer(es), unidad, fecha) junto con sus devoluciones y recolecciones en una
 * sola transacción.
 */
export class CreateReturningDto {
  @IsString()
  @IsNotEmpty()
  subsidiaryId: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  driverIds?: string[];

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturningDevolutionItemDto)
  devolutions?: ReturningDevolutionItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturningCollectionItemDto)
  collections?: ReturningCollectionItemDto[];
}
