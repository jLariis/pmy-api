import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsNumber, IsString } from "class-validator";
import { Role } from "src/common/enums/role.enum";

export class CreateUserDto {
    @ApiProperty({type: String, required: true})
    @IsString()
    @IsNotEmpty()
    firstName: string;

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

    @ApiProperty({ enum: ["admin", "user", "owner"]})
    role: Role;

    @ApiProperty({type: Number, required: true})
    @IsNumber()
    apartmentNumber: number;
}
