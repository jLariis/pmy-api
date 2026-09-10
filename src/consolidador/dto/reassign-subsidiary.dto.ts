import { IsString, MinLength } from 'class-validator';

export class ReassignSubsidiaryDto {
  @IsString() subsidiaryId: string;
  @IsString() @MinLength(3) reason: string;
}
