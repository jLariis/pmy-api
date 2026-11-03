import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsUUID, ValidateNested } from "class-validator";
import { DISPATCH_SORT_MODES, DispatchSortMode } from "src/package-dispatch/dispatch-sort.util";
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

    // Solo salida a ruta (igual que Operaciones → Salidas a ruta).
    @IsOptional()
    @IsDateString({}, { message: 'La fecha de ruta no es válida.' })
    routeDate?: string; // 'YYYY-MM-DD' — día operativo de la ruta (default hoy)

    @IsOptional()
    @IsBoolean()
    is315?: boolean;

    // Orden con el que se armó la salida; se guarda para regenerar PDF/Excel igual.
    @IsOptional()
    @IsIn(DISPATCH_SORT_MODES, { message: 'El orden de la salida no es válido.' })
    sortMode?: DispatchSortMode;

}

/**
 * "Solo generar PDF" (vista previa, no guarda nada): basta la bodega y las guías; unidad,
 * choferes y rutas son opcionales para poder sacar el PDF mientras se arma la salida.
 */
export class PreviewOutboundDto {
    @IsUUID()
    warehouse: string;

    @ValidateNested({ each: true })
    @Type(() => ShipmentWarehouseDto)
    shipments: ShipmentWarehouseDto[];

    @IsOptional()
    @IsUUID()
    vehicle?: string;

    @IsOptional()
    @IsArray()
    drivers?: string[];

    @IsOptional()
    @IsArray()
    routes?: string[];
}
