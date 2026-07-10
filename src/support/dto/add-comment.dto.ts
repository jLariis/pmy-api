import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AddCommentDto {
  @IsString() texto: string;
  @IsBoolean() @IsOptional() internal?: boolean;
}
