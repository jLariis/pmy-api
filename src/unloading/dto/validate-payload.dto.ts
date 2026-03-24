import { IsString, IsBoolean, IsOptional } from 'class-validator';

export class ValidationPayloadDto {
    @IsString()
    trackingNumber: string;

    @IsBoolean()
    isAlreadyValidated: boolean;

    @IsOptional()
    @IsBoolean()
    isValid?: boolean;

    @IsOptional()
    @IsBoolean()
    isCharge?: boolean;

    @IsOptional()
    @IsString()
    consolidatedId?: string;

    @IsOptional()
    @IsString()
    recipientName?: string;

    @IsOptional()
    @IsString()
    recipientAddress?: string;

    @IsOptional()
    @IsString()
    recipientPhone?: string;

    @IsOptional()
    @IsString()
    recipientZip?: string;

    @IsOptional()
    @IsString()
    priority?: string;

    @IsOptional()
    @IsBoolean()
    isHighValue?: boolean;

    @IsOptional()
    payment?: any;

    @IsOptional()
    @IsString()
    commitDateTime?: string;
}