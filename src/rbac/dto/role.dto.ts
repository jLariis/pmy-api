import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { PermissionEffect } from 'src/entities/user-permission.entity';

export class CreateRoleDto {
  @IsString()
  key: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** Códigos de permiso a asignar al crear (opcional). */
  @IsArray()
  @IsOptional()
  permissionCodes?: string[];
}

export class UpdateRoleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class SetRolePermissionsDto {
  @IsArray()
  permissionCodes: string[];
}

export class UserPermissionOverrideDto {
  @IsString()
  code: string;

  @IsIn([PermissionEffect.ALLOW, PermissionEffect.DENY])
  effect: PermissionEffect;
}

export class SetUserPermissionsDto {
  @IsArray()
  overrides: UserPermissionOverrideDto[];
}
