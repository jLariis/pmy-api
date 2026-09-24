import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Vehicle } from 'src/entities/vehicle.entity';
import { MaintenanceRequest } from 'src/entities/maintenance-request.entity';
import { MaintenanceLight, maintenanceStatus, MaintenanceStatusResult } from '../utils/maintenance-status.util';
import { MAX_PLAUSIBLE_KMS } from '../utils/vehicle-kms.util';
import { UpdateScheduleDto } from './dto/schedule.dto';

export interface ScheduleRow {
  vehicle: Pick<Vehicle, 'id' | 'code' | 'name' | 'plateNumber' | 'brand' | 'model' | 'type' | 'status' | 'kms'
    | 'lastMaintenanceDate' | 'lastMaintenanceKms' | 'maintenanceIntervalKms' | 'nextMaintenanceDate'>;
  status: MaintenanceStatusResult;
  openRequest: { id: string; folio: string; status: string } | null;
}

const LIGHT_ORDER: Record<MaintenanceLight, number> = { vencido: 0, proximo: 1, sin_datos: 2, al_dia: 3 };

/** "YYYY-MM-DD" → 07:00Z (medianoche Hermosillo), mismo ancla que el resto de fechas-día del sistema. */
export const dayToDate = (day: string): Date => new Date(`${day.slice(0, 10)}T07:00:00.000Z`);

/** Ordena: vencido → próximo → sin datos → al día; dentro, lo que menos km le falta primero. */
export function sortSchedule(rows: ScheduleRow[]): ScheduleRow[] {
  return [...rows].sort((a, b) =>
    LIGHT_ORDER[a.status.light] - LIGHT_ORDER[b.status.light]
    || (a.status.kmsRemaining ?? Infinity) - (b.status.kmsRemaining ?? Infinity)
    || (a.status.daysRemaining ?? Infinity) - (b.status.daysRemaining ?? Infinity));
}

@Injectable()
export class ScheduleService {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(MaintenanceRequest) private readonly requests: Repository<MaintenanceRequest>,
  ) {}

  async bySubsidiary(subsidiaryId: string, today = new Date()): Promise<ScheduleRow[]> {
    const vehicles = await this.vehicles.find({ where: { subsidiary: { id: subsidiaryId } }, order: { name: 'ASC' } });
    const open = vehicles.length
      ? await this.requests.find({
          where: { vehicleId: In(vehicles.map((v) => v.id)), status: Not(In(['completada', 'cancelada'])) },
          order: { createdAt: 'DESC' },
        })
      : [];
    const openByVehicle = new Map<string, MaintenanceRequest>();
    for (const r of open) if (!openByVehicle.has(r.vehicleId)) openByVehicle.set(r.vehicleId, r);

    return sortSchedule(vehicles.map((v) => {
      const r = openByVehicle.get(v.id);
      return {
        vehicle: {
          id: v.id, code: v.code, name: v.name, plateNumber: v.plateNumber, brand: v.brand, model: v.model, type: v.type,
          status: v.status, kms: v.kms, lastMaintenanceDate: v.lastMaintenanceDate, lastMaintenanceKms: v.lastMaintenanceKms,
          maintenanceIntervalKms: v.maintenanceIntervalKms, nextMaintenanceDate: v.nextMaintenanceDate,
        },
        status: maintenanceStatus(v, today),
        openRequest: r ? { id: r.id, folio: r.folio, status: r.status } : null,
      };
    }));
  }

  /** Programar / corregir datos de mantenimiento de la unidad (incluye corrección manual del km actual). */
  async updateVehicle(vehicleId: string, dto: UpdateScheduleDto) {
    const v = await this.vehicles.findOne({ where: { id: vehicleId } });
    if (!v) throw new NotFoundException('Vehículo no encontrado');
    if (dto.kms !== undefined && (dto.kms < 0 || dto.kms > MAX_PLAUSIBLE_KMS)) {
      throw new BadRequestException('El km actual no es válido.');
    }
    const patch: Partial<Vehicle> = {};
    if (dto.kms !== undefined) patch.kms = dto.kms;
    if (dto.maintenanceIntervalKms !== undefined) patch.maintenanceIntervalKms = dto.maintenanceIntervalKms;
    if (dto.lastMaintenanceKms !== undefined) patch.lastMaintenanceKms = dto.lastMaintenanceKms;
    if (dto.lastMaintenanceDate !== undefined) patch.lastMaintenanceDate = dto.lastMaintenanceDate ? dayToDate(dto.lastMaintenanceDate) : (null as any);
    if (dto.nextMaintenanceDate !== undefined) patch.nextMaintenanceDate = dto.nextMaintenanceDate ? dayToDate(dto.nextMaintenanceDate) : (null as any);
    await this.vehicles.update(vehicleId, patch);
    return this.vehicles.findOne({ where: { id: vehicleId } });
  }
}
