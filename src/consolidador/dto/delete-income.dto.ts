import { IsString, MinLength } from 'class-validator';

export class DeleteIncomeDto {
  @IsString() @MinLength(3) reason: string;
}
