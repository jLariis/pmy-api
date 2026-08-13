import { IsOptional, IsString } from 'class-validator';

export class AddCommentDto {
  @IsString() texto: string;
  // Llega como boolean (JSON) o string (multipart); se coacciona en el service.
  @IsOptional() internal?: boolean | string;
}
