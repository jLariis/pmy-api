import { IsBoolean, IsDefined, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { Subsidiary } from "src/entities/subsidiary.entity";

export class CollectionDto {
    @IsString()
    @IsNotEmpty()
    trackingNumber: string;

    @IsDefined()
    @IsObject()
    subsidiary: Subsidiary;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsBoolean()
    isPickUp?: boolean;

    @IsOptional()
    @IsString()
    date?: string;
}
