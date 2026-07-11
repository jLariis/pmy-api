import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { DocumentFormat } from 'src/entities/document-template.entity';

const FORMATS = ['email', 'pdf', 'excel', 'report', 'letter', 'receipt', 'label', 'statement'];

export class CreateTemplateDto {
  @IsString() @MaxLength(80) code: string;
  @IsString() @MaxLength(160) name: string;
  @IsIn(FORMATS) type: DocumentFormat;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
}

export class SaveDraftDto {
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsObject() designJson?: any;
  @IsOptional() @IsString() compiledBody?: string;
  @IsOptional() @IsString() @MaxLength(500) changelog?: string;
}

export class PublishDto { @IsString() versionId: string; }
export class RestoreDto { @IsString() fromVersionId: string; }

export class TestSendDto {
  @IsString() to: string;
  @IsOptional() @IsObject() sampleData?: Record<string, any>;
}

export class PreviewDto { @IsOptional() @IsObject() sampleData?: Record<string, any>; }

export class UpsertBrandDto {
  @IsOptional() @IsString() logoLight?: string;
  @IsOptional() @IsString() logoDark?: string;
  @IsOptional() @IsObject() colors?: Record<string, string>;
  @IsOptional() @IsObject() typography?: Record<string, string>;
  @IsOptional() @IsString() borderRadius?: string;
  @IsOptional() @IsObject() spacing?: Record<string, string>;
  @IsOptional() @IsObject() fiscal?: Record<string, string>;
  @IsOptional() @IsObject() contact?: Record<string, string>;
  @IsOptional() @IsObject() social?: Record<string, string>;
  @IsOptional() @IsBoolean() active?: boolean;
}
