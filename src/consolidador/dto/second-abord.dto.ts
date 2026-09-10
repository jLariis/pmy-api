import { IsBoolean, IsString, MinLength } from 'class-validator';

export class SecondAbordDto {
  @IsBoolean() enabled: boolean;
  @IsString() @MinLength(3) reason: string;
}
