import { Type } from "class-transformer";
import { IsArray, IsEnum, IsNumber, IsOptional, IsUUID, ValidateNested } from "class-validator";
import { ShipmentWarehouseDto } from "./create-warehouse.dto";
import { Route } from "src/entities/route.entity";
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

    @IsArray()
    routes: Route[];

    @IsEnum(OutboundType)
    type: OutboundType;

    @IsNumber()
    kms: number;

    @IsOptional()
    @IsUUID()
    destinationId: string;

}
