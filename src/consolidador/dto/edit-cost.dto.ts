import { IsNumber, IsString, Min, MinLength } from 'class-validator';

export class EditCostDto {
  @IsNumber() @Min(0) cost: number;
  @IsString() @MinLength(3) reason: string;
}
