import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/** MT = expediente de mantenimiento (antes SM), OC = orden de compra. */
export type FolioPrefix = 'MT' | 'SM' | 'OC';

export const formatFolio = (prefix: string, n: number): string => `${prefix}-${String(n).padStart(6, '0')}`;

/** Folios consecutivos sin duplicados: bloquea la fila del contador dentro de la transacción del llamador. */
@Injectable()
export class FolioService {
  async next(manager: EntityManager, prefix: FolioPrefix): Promise<string> {
    const rows: Array<{ lastValue: number }> = await manager.query(
      'SELECT lastValue FROM maintenance_folio_counter WHERE prefix = ? FOR UPDATE',
      [prefix],
    );
    const n = Number(rows[0]?.lastValue ?? 0) + 1;
    if (rows.length === 0) {
      await manager.query('INSERT INTO maintenance_folio_counter (prefix, lastValue) VALUES (?, ?)', [prefix, n]);
    } else {
      await manager.query('UPDATE maintenance_folio_counter SET lastValue = ? WHERE prefix = ?', [n, prefix]);
    }
    return formatFolio(prefix, n);
  }
}
