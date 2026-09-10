import { IsIn, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateManualIncomeDto {
  @IsString() subsidiaryId: string;
  @IsIn(['recoleccion', 'pod', 'dex', 'manual']) kind: 'recoleccion' | 'pod' | 'dex' | 'manual';
  @IsOptional() @IsString() trackingNumber?: string;
  @IsNumber() @Min(0) cost: number;
  /** YYYY-MM-DD: día de la operación (debe caer dentro de la semana). */
  @IsString() date: string;
  @IsString() @MinLength(3) reason: string;
}
