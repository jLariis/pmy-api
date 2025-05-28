import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class AuthDto {
    @ApiProperty({ type: String })
    @IsEmail()
    email: string;

    @ApiProperty({ type: String })
    @IsNotEmpty()
    password: string;
}