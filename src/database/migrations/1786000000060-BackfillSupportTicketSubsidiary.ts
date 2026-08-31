import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soporte: rellena `support_ticket.subsidiaryId` en los tickets históricos que
 * quedaron en NULL. La sucursal se toma de la sucursal primaria del usuario que
 * reportó (`user.subsidiaryId`), que es la misma fuente que ahora usa el alta.
 *
 * Causa: el alta leía `req.user.subsidiaryId` (inexistente) en vez de la sucursal
 * primaria del token; se corrigió en support.service. Este backfill deja el
 * histórico consistente. Idempotente (solo toca filas con subsidiaryId NULL).
 */
export class BackfillSupportTicketSubsidiary1786000000060 implements MigrationInterface {
  name = 'BackfillSupportTicketSubsidiary1786000000060';

  public async up(q: QueryRunner): Promise<void> {
    // `support_ticket.requesterId` y `user.id` tienen collations distintas
    // (utf8mb4_0900_ai_ci vs utf8mb4_unicode_ci); se fuerza una común en el JOIN
    // para evitar ER_CANT_AGGREGATE_2COLLATIONS.
    await q.query(`
      UPDATE \`support_ticket\` st
      JOIN \`user\` u
        ON u.id COLLATE utf8mb4_unicode_ci = st.requesterId COLLATE utf8mb4_unicode_ci
      SET st.subsidiaryId = u.subsidiaryId
      WHERE st.subsidiaryId IS NULL AND u.subsidiaryId IS NOT NULL
    `);
  }

  public async down(): Promise<void> {
    // Backfill de datos: no es reversible de forma segura (no se puede distinguir
    // qué filas estaban en NULL antes). No-op intencional.
  }
}
