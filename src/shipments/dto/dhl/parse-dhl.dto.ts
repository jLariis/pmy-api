import { IsString } from 'class-validator';

export class ParseDhlDto {
  @IsString()
  rawText: string;
}