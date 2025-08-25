import { IsArray, IsString, ArrayNotEmpty } from 'class-validator';

export class ValidateTrackingNumbersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  trackingNumbers: string[];

  @IsString()
  subsidiaryId: string;
}