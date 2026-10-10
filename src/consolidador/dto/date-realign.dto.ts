import { ArrayMaxSize, IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class DateRealignApplyDto {
  /** Ingresos a corregir (de la vista previa); vacío = todos los corregibles de la semana. */
  @IsOptional() @IsArray({ message: 'La lista de ingresos no es válida.' }) @ArrayMaxSize(2000)
  @IsString({ each: true, message: 'La lista de ingresos no es válida.' })
  incomeIds?: string[];

  @IsString({ message: 'Escribe el motivo.' }) @MinLength(3, { message: 'El motivo debe tener al menos 3 letras.' })
  reason: string;
}
