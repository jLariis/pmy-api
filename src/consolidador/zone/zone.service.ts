import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { pickScopeSubsidiaries, runWithLimit } from '../logic/zone-scope.util';
import type { ScopeSubsidiary, ZonePart } from './zone.types';

/** Sucursales a la vez al recorrer una zona (cuida la BD y la máquina de 8 GB). */
const ZONE_CONCURRENCY = 2;

export interface ZoneUser {
  role?: string;
  subsidiaryIds?: string[];
}

/** Consolidador por zona: resuelve las sucursales de la zona y corre una vista por sucursal. */
@Injectable()
export class ZoneService {
  private readonly logger = new Logger(ZoneService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Sucursales de la zona que el usuario puede ver. Lanza un 403 en llano si no queda ninguna. */
  async subsidiariesOf(zoneId: string, user: ZoneUser): Promise<ScopeSubsidiary[]> {
    const rows: any[] = await this.dataSource.query(`SELECT id, name, zoneId, active FROM subsidiary WHERE zoneId = ?`, [zoneId]);
    const subs = pickScopeSubsidiaries(
      rows.map((r) => ({ id: String(r.id), name: String(r.name ?? ''), zoneId: r.zoneId ?? null, active: !!Number(r.active ?? 1) })),
      zoneId,
      { role: String(user?.role ?? ''), subsidiaryIds: user?.subsidiaryIds ?? [] },
    );
    if (!subs.length) {
      throw new ForbiddenException(
        rows.length
          ? 'No tienes sucursales asignadas en esta zona.'
          : 'Esta zona no tiene sucursales asignadas. Asígnalas en Administración → Zonas.',
      );
    }
    return subs;
  }

  /** Corre `fn` por cada sucursal de la zona (2 a la vez). Una sucursal que falla no tumba a las demás. */
  async run<T>(zoneId: string, user: ZoneUser, fn: (s: ScopeSubsidiary) => Promise<T>): Promise<ZonePart<T>[]> {
    const subs = await this.subsidiariesOf(zoneId, user);
    const settled = await runWithLimit(subs, ZONE_CONCURRENCY, fn);
    return subs.map((s, i) => {
      const r = settled[i];
      if (r.status === 'fulfilled') return { subsidiaryId: s.id, subsidiaryName: s.name, data: r.value, error: null };
      this.logger.error(`Zona ${zoneId}: falló la sucursal ${s.name} (${s.id}): ${(r.reason as Error)?.message ?? r.reason}`);
      return { subsidiaryId: s.id, subsidiaryName: s.name, data: null, error: 'No se pudo cargar esta sucursal.' };
    });
  }
}
