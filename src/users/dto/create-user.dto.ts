import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";
import { Subsidiary } from "src/entities";

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

    /*** Estos se van a definir más adelante */
    @ApiProperty({ enum: ["admin", "user", "owner"]})
    role?: 'admin' | 'user';

    @ApiProperty({type: String, required: false})
    avatar?: string;

    @ApiProperty({type: () => Subsidiary, required: true})
    subsidiary?: Subsidiary;
    
}
