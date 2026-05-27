import { IsOptional, IsString } from "class-validator";

export class CreateZoneDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string
}
