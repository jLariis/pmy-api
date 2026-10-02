import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { normalize } from './text-normalize.util';
import { computeLearning, LearnInput } from './learning.util';
import { Knowledge, Region } from './inbox.types';

/**
 * "Conocimiento" del detector: catálogo de sucursales, cobertura CP, pistas
 * aprendidas y consolidados ya registrados. También aplica el aprendizaje cuando
 * alguien confirma (o corrige) la sucursal de un correo.
 */
@Injectable()
export class KnowledgeService {
  private cache: { at: number; base: Omit<Knowledge, 'knownConsolidations'> } | null = null;
  private static readonly TTL_MS = 2 * 60_000;

  constructor(
    private readonly ds: DataSource,
    private readonly config: ConfigService,
  ) {}

  ownDomains(): string[] {
    return (this.config.get<string>('INBOX_OWN_DOMAINS') || 'paqueteriaymensajeriadelyaqui.com')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }

  invalidate(): void {
    this.cache = null;
  }

  static regionOf(state: string | null): Region | null {
    const s = normalize(state);
    if (s.includes('BAJA CALIFORNIA SUR') || s === 'BCS') return 'BCS';
    if (s.includes('SONORA')) return 'SON';
    return null;
  }

  async load(consNumbers: string[]): Promise<Knowledge> {
    if (!this.cache || Date.now() - this.cache.at > KnowledgeService.TTL_MS) {
      const subs: any[] = await this.ds.query('SELECT id, name, state FROM subsidiary WHERE active = 1');
      const zips: any[] = await this.ds.query(
        `SELECT zip, subsidiaryId, share, status, city FROM subsidiary_zip_coverage WHERE status <> 'excluido'`,
      );
      const aliases: any[] = await this.ds.query('SELECT signalType, term, subsidiaryId, hits, misses FROM inbox_signal_alias');
      this.cache = {
        at: Date.now(),
        base: {
          subsidiaries: subs.map((s) => ({ id: s.id, name: s.name, region: KnowledgeService.regionOf(s.state) })),
          zipCoverage: zips.map((z) => ({ zip: z.zip, subsidiaryId: z.subsidiaryId, share: Number(z.share), status: z.status, city: z.city })),
          aliases: aliases.map((a) => ({ signalType: a.signalType, term: a.term, subsidiaryId: a.subsidiaryId, hits: Number(a.hits), misses: Number(a.misses) })),
        },
      };
    }
    return { ...this.cache.base, knownConsolidations: await this.knownConsolidations(consNumbers) };
  }

  private async knownConsolidations(consNumbers: string[]): Promise<Knowledge['knownConsolidations']> {
    const list = [...new Set(consNumbers.filter(Boolean))];
    if (!list.length) return [];
    const ph = list.map(() => '?').join(',');
    const rows: any[] = await this.ds.query(
      `SELECT consNumber, subsidiaryId FROM consolidated WHERE active = 1 AND subsidiaryId IS NOT NULL AND consNumber IN (${ph})
       UNION
       SELECT consNumber, subsidiaryId FROM charge WHERE subsidiaryId IS NOT NULL AND consNumber IN (${ph})`,
      [...list, ...list],
    );
    return rows.map((r) => ({ consNumber: r.consNumber, subsidiaryId: r.subsidiaryId }));
  }

  /**
   * Aprende de una confirmación: +1 acierto a la sucursal confirmada y +1 error a
   * las demás sucursales que tenían esa misma pista. Si se corrige una confirmación
   * previa (`previousSubsidiaryId`), primero deshace el acierto anterior.
   */
  async learn(input: Omit<LearnInput, 'ownDomains'>, subsidiaryId: string, previousSubsidiaryId: string | null): Promise<void> {
    const terms = computeLearning({ ...input, ownDomains: this.ownDomains() });
    for (const t of terms) {
      if (previousSubsidiaryId && previousSubsidiaryId !== subsidiaryId) {
        await this.ds.query(
          'UPDATE inbox_signal_alias SET hits = GREATEST(hits - 1, 0) WHERE signalType = ? AND term = ? AND subsidiaryId = ?',
          [t.signalType, t.term, previousSubsidiaryId],
        );
        await this.ds.query(
          'UPDATE inbox_signal_alias SET misses = GREATEST(misses - 1, 0) WHERE signalType = ? AND term = ? AND subsidiaryId <> ?',
          [t.signalType, t.term, previousSubsidiaryId],
        );
      }
      if (previousSubsidiaryId === subsidiaryId) continue;
      await this.ds.query(
        `INSERT INTO inbox_signal_alias (id, signalType, term, subsidiaryId, hits, misses, source, lastSeenAt)
         VALUES (?, ?, ?, ?, 1, 0, 'confirmacion', NOW())
         ON DUPLICATE KEY UPDATE hits = hits + 1, lastSeenAt = NOW()`,
        [randomUUID(), t.signalType, t.term, subsidiaryId],
      );
      await this.ds.query(
        'UPDATE inbox_signal_alias SET misses = misses + 1 WHERE signalType = ? AND term = ? AND subsidiaryId <> ?',
        [t.signalType, t.term, subsidiaryId],
      );
    }
    this.invalidate();
  }
}
