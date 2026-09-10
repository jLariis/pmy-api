import { IsString, MinLength } from 'class-validator';

export class EditDateDto {
  /** Fecha del ingreso en formato YYYY-MM-DD. */
  @IsString() date: string;
  @IsString() @MinLength(3) reason: string;
}
