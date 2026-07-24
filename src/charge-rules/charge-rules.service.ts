import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ChargeRule } from 'src/entities/charge-rule.entity';
import { ChargeableResolver } from 'src/common/income-rules.util';
import { UpsertChargeRuleDto } from './dto/charge-rule.dto';

const norm = (v: any) => String(v ?? '').trim().toLowerCase();
const keyOf = (carrier: string, code: string) => `${norm(carrier)}|${String(code ?? '').trim()}`;

/**
 * Resolvedor de cobro que combina reglas GLOBALES + override de SUCURSAL.
 * `isChargeable` devuelve la regla más específica; `undefined` si no hay ninguna
 * (el lector aplica entonces el fallback histórico = cuenta).
 */
class MapChargeResolver implements ChargeableResolver {
  constructor(
    private readonly global: Map<string, boolean>,
    private readonly sub: Map<string, boolean>,
  ) {}
  isChargeable(carrier: string, code: string): boolean | undefined {
    const k = keyOf(carrier, code);
    if (this.sub.has(k)) return this.sub.get(k);
    if (this.global.has(k)) return this.global.get(k);
    return undefined;
  }
}

@Injectable()
export class ChargeRulesService {
  constructor(
    @InjectRepository(ChargeRule) private readonly repo: Repository<ChargeRule>,
  ) {}

  /** Todas las reglas (global + por sucursal) para la UI de Configuración. */
  async getAll() {
    const rules = await this.repo.find({ order: { carrier: 'ASC', code: 'ASC' } });
    return {
      global: rules.filter((r) => !r.subsidiaryId),
      bySubsidiary: rules.filter((r) => !!r.subsidiaryId),
    };
  }

  /** Reglas efectivas para una sucursal (override sobre global), para previsualizar. */
  async getEffective(subsidiaryId: string) {
    const [global, sub] = await Promise.all([
      this.repo.find({ where: { subsidiaryId: IsNull() } }),
      this.repo.find({ where: { subsidiaryId } }),
    ]);
    const map = new Map<string, { carrier: string; code: string; chargeable: boolean; source: 'sucursal' | 'global' }>();
    for (const r of global) map.set(keyOf(r.carrier, r.code), { carrier: r.carrier, code: r.code, chargeable: r.chargeable, source: 'global' });
    for (const r of sub) map.set(keyOf(r.carrier, r.code), { carrier: r.carrier, code: r.code, chargeable: r.chargeable, source: 'sucursal' });
    return [...map.values()];
  }

  /** Alta/edición de una regla (global si subsidiaryId es null/omitido). */
  async upsert(dto: UpsertChargeRuleDto) {
    const carrier = norm(dto.carrier);
    const code = String(dto.code ?? '').trim();
    const subsidiaryId = dto.subsidiaryId ? dto.subsidiaryId : null;
    const existing = await this.repo.findOne({
      where: { carrier, code, subsidiaryId: subsidiaryId ?? IsNull() },
    });
    if (existing) {
      existing.chargeable = dto.chargeable;
      existing.updatedAt = new Date();
      return this.repo.save(existing);
    }
    return this.repo.save(this.repo.create({ carrier, code, chargeable: dto.chargeable, subsidiaryId }));
  }

  /** Elimina un override de sucursal (vuelve a heredar el global). */
  async remove(id: string) {
    await this.repo.delete({ id });
    return { deleted: true };
  }

  /**
   * Construye el resolvedor para una sucursal (o solo-global si no se pasa).
   * Se usa en los lectores de ingresos para decidir qué cuenta.
   */
  async buildResolver(subsidiaryId?: string): Promise<ChargeableResolver> {
    const globalRules = await this.repo.find({ where: { subsidiaryId: IsNull() } });
    const global = new Map<string, boolean>();
    for (const r of globalRules) global.set(keyOf(r.carrier, r.code), r.chargeable);

    const sub = new Map<string, boolean>();
    if (subsidiaryId) {
      const subRules = await this.repo.find({ where: { subsidiaryId } });
      for (const r of subRules) sub.set(keyOf(r.carrier, r.code), r.chargeable);
    }
    return new MapChargeResolver(global, sub);
  }
}
