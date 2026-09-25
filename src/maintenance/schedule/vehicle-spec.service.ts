import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Vehicle } from 'src/entities/vehicle.entity';
import { VehicleSpecItem } from 'src/entities/vehicle-spec-item.entity';

export class VehicleSpecItemDto {
  @IsUUID('all', { message: 'Elige la pieza o el insumo' })
  categoryId: string;

  @IsOptional() @ValidateIf((o) => o.productId !== null) @IsUUID('all', { message: 'Producto no reconocido' })
  productId?: string | null;

  @IsNumber({}, { message: 'La cantidad debe ser un número' }) @Min(0.01, { message: 'La cantidad debe ser mayor a 0' })
  quantity: number;

  @IsOptional() @ValidateIf((o) => o.unitId !== null) @IsUUID('all', { message: 'Unidad de medida no válida' })
  unitId?: string | null;

  @IsOptional() @IsString() @MaxLength(300, { message: 'La nota es demasiado larga' })
  notes?: string | null;
}

export class VehicleSpecDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => VehicleSpecItemDto)
  items: VehicleSpecItemDto[];
}

/** Ficha técnica de la unidad: piezas e insumos que lleva (se sugieren al hacer solicitudes). */
@Injectable()
export class VehicleSpecService {
  constructor(
    @InjectRepository(VehicleSpecItem) private readonly items: Repository<VehicleSpecItem>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
  ) {}

  list(vehicleId: string) {
    return this.items.find({
      where: { vehicleId },
      relations: ['category', 'product', 'unit'],
      order: { createdAt: 'ASC' },
    });
  }

  /** Reemplaza la ficha completa (lo que no viene se borra). */
  async replace(vehicleId: string, dto: VehicleSpecDto) {
    if (!(await this.vehicles.exist({ where: { id: vehicleId } }))) throw new NotFoundException('Unidad no encontrada');
    await this.items.manager.transaction(async (m) => {
      await m.delete(VehicleSpecItem, { vehicleId });
      if (dto.items.length) {
        await m.save(VehicleSpecItem, dto.items.map((i) => m.create(VehicleSpecItem, {
          vehicleId, categoryId: i.categoryId, productId: i.productId ?? null, quantity: i.quantity,
          unitId: i.unitId ?? null, notes: i.notes?.trim() || null,
        })));
      }
    });
    return this.list(vehicleId);
  }
}
