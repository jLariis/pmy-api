import { Injectable, Logger, Inject, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/entities/user.entity';
import { RbacService } from '../rbac/rbac.service';

/**
 * Contexto de sesión "pesado" del usuario (permisos efectivos + sucursales).
 *
 * ¿Por qué existe? El JWT dejó de almacenar estado: ahora solo lleva
 * { sub, email, role }. Pero los guards (PermissionsGuard, SubsidiaryScopeGuard,
 * IncomeAccessGuard) siguen necesitando `permissions` y `subsidiaryIds` en
 * `req.user`. Esta clase resuelve ese contexto DESDE LA BD en cada request
 * (vía JwtStrategy), con una caché en memoria de corta duración para no pegarle
 * a la BD en cada llamada.
 *
 * Caché: Map<userId, {data, expiresAt}> con TTL corto (TTL_MS). Es por-instancia;
 * en un despliegue multi-instancia cada nodo tiene la suya. El TTL corto acota la
 * inconsistencia tras un cambio de permisos; además exponemos `invalidate(userId)`
 * para que RBAC purgue de inmediato al reasignar permisos/sucursales.
 */
export interface EnrichedSession {
  role: string;
  name?: string;
  lastName?: string;
  subsidiary: any;
  additionalSubsidiaries: any[];
  subsidiaryIds: string[];
  permissions: string[];
}

interface CacheEntry {
  data: EnrichedSession;
  expiresAt: number;
}

@Injectable()
export class SessionContextService {
  /** TTL de la caché en ms. 30s equilibra frescura de permisos vs. carga a BD. */
  private static readonly TTL_MS = 30_000;

  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly rbacService: RbacService,
    @Inject(Logger) private readonly logger: LoggerService,
  ) {}

  /**
   * Devuelve el contexto enriquecido del usuario. Sirve de caché si está fresco;
   * si no, lo recalcula desde la BD. Devuelve `null` si el usuario no existe o
   * está inactivo (el llamador decide si rechaza la sesión).
   */
  async getEnrichedSession(userId: string): Promise<EnrichedSession | null> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const session = await this.buildFromDb(userId);
    if (session) {
      this.cache.set(userId, { data: session, expiresAt: Date.now() + SessionContextService.TTL_MS });
    }
    return session;
  }

  /** Purga la caché de un usuario (llamar tras cambiar sus permisos/sucursales). */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  /** Purga toda la caché (p.ej. al cambiar permisos de un rol que afecta a muchos). */
  invalidateAll(): void {
    this.cache.clear();
  }

  private async buildFromDb(userId: string): Promise<EnrichedSession | null> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['subsidiary', 'additionalSubsidiaries'],
    });

    if (!user || user.active === false) {
      return null;
    }

    // Permisos efectivos (rol ∪ allow − deny). Si RBAC no está sembrado o falla,
    // no rompemos la sesión: se entrega [] y el gateo cae al mapa de roles legacy.
    let permissions: string[] = [];
    try {
      permissions = await this.rbacService.getEffectivePermissions(userId);
    } catch (err: any) {
      this.logger.warn(
        `No se pudieron calcular permisos efectivos para ${user.email}: ${err?.message}`,
        SessionContextService.name,
      );
    }

    const additionalSubsidiaries = user.additionalSubsidiaries || [];
    const subsidiaryIds = [
      user.subsidiary?.id,
      ...additionalSubsidiaries.map((s) => s.id),
    ].filter(Boolean) as string[];

    return {
      role: user.role,
      name: user.name,
      lastName: user.lastName,
      subsidiary: user.subsidiary,
      additionalSubsidiaries,
      subsidiaryIds,
      permissions,
    };
  }
}
