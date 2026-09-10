import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class SearchBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  trackings: string[];
}
