import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { deriveLegacyRequestItems } from '../../maintenance/utils/legacy-items.util';

/**
 * Solicitudes de la v2 (producción): no tenían renglones, solo partidas en cada cotización. Sin renglones,
 * el comparativo por concepto sale vacío y no se pueden generar órdenes. Se derivan renglones agrupando las
 * partidas iguales entre cotizaciones y se enlazan (`requestItemId`); la partida de la cotización ganadora
 * queda como elegida. Idempotente: solo toca solicitudes sin renglones.
 */
export class LegacyRequestItems1786000000084 implements MigrationInterface {
  name = 'LegacyRequestItems1786000000084';

  public async up(q: QueryRunner): Promise<void> {
    const requests: Array<{ id: string }> = await q.query(
      `SELECT r.id FROM maintenance_request r
        WHERE r.deletedAt IS NULL
          AND NOT EXISTS (SELECT 1 FROM request_item ri WHERE ri.requestId = r.id)
          AND EXISTS (SELECT 1 FROM maintenance_quote mq WHERE mq.requestId = r.id AND mq.deletedAt IS NULL)`,
    );
    for (const { id } of requests) {
      const rows: Array<{ id: string; quoteId: string; productId: string | null; description: string; quantity: string; winner: number }> = await q.query(
        `SELECT qi.id, qi.quoteId, qi.productId, qi.description, qi.quantity, (mq.status = 'ganadora') AS winner
           FROM maintenance_quote_item qi
           JOIN maintenance_quote mq ON mq.id = qi.quoteId AND mq.deletedAt IS NULL
          WHERE mq.requestId = ? AND qi.requestItemId IS NULL AND qi.requestNeedId IS NULL
          ORDER BY mq.createdAt, qi.id`,
        [id],
      );
      const groups = deriveLegacyRequestItems(rows.map((r) => ({
        id: r.id, quoteId: r.quoteId, productId: r.productId, description: r.description, quantity: Number(r.quantity), winner: !!Number(r.winner),
      })));
      let sort = 0;
      for (const g of groups) {
        const itemId = randomUUID();
        await q.query(
          'INSERT INTO `request_item` (`id`, `requestId`, `productId`, `description`, `quantity`, `selectedQuoteItemId`, `sortOrder`) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [itemId, id, g.productId, g.description.slice(0, 300), g.quantity, g.selectedQuoteItemId, sort++],
        );
        await q.query(
          `UPDATE maintenance_quote_item SET requestItemId = ? WHERE id IN (${g.quoteItemIds.map(() => '?').join(',')})`,
          [itemId, ...g.quoteItemIds],
        );
      }
    }
  }

  public async down(): Promise<void> {
    // Sin reversa: los renglones derivados son necesarios para operar las solicitudes migradas.
  }
}
