import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateHolidayDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  /** Fecha 'YYYY-MM-DD'. Para recurrentes solo se usa el mes-día. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date debe ser YYYY-MM-DD' })
  date: string;

  /** true = aplica cada año (mes-día); false = solo esa fecha exacta. */
  @IsBoolean()
  @IsOptional()
  recurring?: boolean;
}
