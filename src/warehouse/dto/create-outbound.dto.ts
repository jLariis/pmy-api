import { Type } from "class-transformer";
import { IsArray, IsEnum, IsNumber, IsOptional, IsUUID, ValidateNested } from "class-validator";
import { ShipmentWarehouseDto } from "./create-warehouse.dto";
import { OutboundType } from "src/common/enums/outbound-type.enum";

export class CreateOutboundDto {
    @IsUUID()
    warehouse: string;
    
    @ValidateNested({ each: true })
    @Type(() => ShipmentWarehouseDto)
    shipments: ShipmentWarehouseDto[];
    
    @IsUUID()
    vehicle: string;
    
    @IsArray()
    drivers: string[];

    @IsOptional()
    @IsArray()
    routes?: string[];

    @IsEnum(OutboundType)
    type: OutboundType;

    @IsOptional()
    @IsNumber()
    kms?: number;

    @IsOptional()
    @IsUUID()
    destinationId: string;

}
