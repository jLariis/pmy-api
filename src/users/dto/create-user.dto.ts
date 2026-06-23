import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { Subsidiary } from "src/entities";

// Roles válidos hoy (incluye variantes históricas). Evita que se inyecte un role
// arbitrario en el registro. Se reemplazará por validación contra la tabla `role`
// cuando aterrice el RBAC.
export const VALID_USER_ROLES = ['admin', 'user', 'auxiliar', 'bodega', 'superadmin', 'superamin', 'subadmin', 'owner'] as const;
export type UserRoleValue = (typeof VALID_USER_ROLES)[number];

export class CreateUserDto {
    @ApiProperty({type: String, required: true})
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({type: String, required: true})
    @IsString()
    @IsNotEmpty()
    lastName: string;

    @ApiProperty({type: String, required: true, uniqueItems: true})
    @IsEmail()
    email: string;

    @ApiProperty({type: String, required: true})
    @IsNotEmpty()
    password: string;

    @ApiProperty({ enum: VALID_USER_ROLES, required: false })
    @IsOptional()
    @IsIn(VALID_USER_ROLES)
    role?: UserRoleValue;

    @ApiProperty({type: String, required: false})
    avatar?: string;

    @ApiProperty({type: () => Subsidiary, required: true})
    subsidiary?: Subsidiary;
    
}
