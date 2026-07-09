import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateExpenseCategoryDto {
  @IsString() name: string;
  @IsString() @IsOptional() groupId?: string;
  @IsInt() @IsOptional() sortOrder?: number;
  @IsString() @IsOptional() description?: string;
}

export class UpdateExpenseCategoryDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() groupId?: string;
  @IsInt() @IsOptional() sortOrder?: number;
  @IsBoolean() @IsOptional() active?: boolean;
  @IsString() @IsOptional() description?: string;
}

export class CreateExpenseGroupDto {
  @IsString() name: string;
  @IsString() @IsOptional() icon?: string;
  @IsInt() @IsOptional() sortOrder?: number;
}

export class UpdateExpenseGroupDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() icon?: string;
  @IsInt() @IsOptional() sortOrder?: number;
  @IsBoolean() @IsOptional() active?: boolean;
}
