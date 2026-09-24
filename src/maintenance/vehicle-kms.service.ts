import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from 'src/entities/vehicle.entity';
import { nextVehicleKms } from './utils/vehicle-kms.util';

export type KmsSource = 'dispatch' | 'closure' | 'request' | 'completion';

/**
 * Km vivo del vehículo: cada captura de km (salida a ruta, cierre, solicitud, cierre de orden)
 * lo actualiza con la regla "solo sube / plausible". NUNCA hace fallar la operación que lo llama.
 */
@Injectable()
export class VehicleKmsService {
  private readonly logger = new Logger(VehicleKmsService.name);

  constructor(@InjectRepository(Vehicle) private readonly repo: Repository<Vehicle>) {}

  async bump(vehicleId: string | undefined | null, captured: unknown, source: KmsSource): Promise<void> {
    if (!vehicleId) return;
    try {
      const v = await this.repo.findOne({ where: { id: vehicleId }, select: ['id', 'kms'] });
      if (!v) return;
      const r = nextVehicleKms(v.kms, captured);
      if (!r.changed) {
        if (r.reason === 'jump') this.logger.warn(`km ignorado (${source}) vehículo ${vehicleId}: ${v.kms} → ${captured}`);
        return;
      }
      await this.repo.update(vehicleId, { kms: r.kms! });
    } catch (e: any) {
      this.logger.warn(`no se pudo actualizar km (${source}) ${vehicleId}: ${e?.message}`);
    }
  }

  /** Igual que `bump` pero resolviendo el vehículo desde la salida a ruta. */
  async bumpFromDispatch(dispatchId: string | undefined | null, captured: unknown, source: KmsSource): Promise<void> {
    if (!dispatchId) return;
    try {
      const rows: Array<{ vehicleId: string | null }> = await this.repo.manager.query(
        'SELECT vehicleId FROM package_dispatch WHERE id = ? LIMIT 1',
        [dispatchId],
      );
      await this.bump(rows[0]?.vehicleId, captured, source);
    } catch (e: any) {
      this.logger.warn(`no se pudo resolver vehículo de la salida ${dispatchId}: ${e?.message}`);
    }
  }
}
