import { IsString, MinLength } from 'class-validator';

export class RepairIncomeDto {
  @IsString() @MinLength(3) reason: string;
}
