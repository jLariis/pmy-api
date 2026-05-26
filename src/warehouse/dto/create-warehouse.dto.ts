import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";


export class CreateRemittanceDto {
    @IsString()
    pieceTrackingNumber: string;

    @IsString()
    shipmentId: string;
}

export class ShipmentWarehouseDto {
    @IsUUID()
    id: string;

    @IsString()
    trackingNumber: string;

    @IsString()
    shipmentType: string;

    @IsBoolean()
    isCharge: boolean;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateRemittanceDto)
    @IsOptional()
    remittances?: CreateRemittanceDto[];
}

export class CreateWarehouseDto {
    @IsUUID()
    warehouse: string;
    
    @ValidateNested({ each: true })
    @Type(() => ShipmentWarehouseDto)
    shipments: ShipmentWarehouseDto[];
    
    @IsUUID()
    vehicle: string;
    
    @IsArray()
    drivers: string[];
}
