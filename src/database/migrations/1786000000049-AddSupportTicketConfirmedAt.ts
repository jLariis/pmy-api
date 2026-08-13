import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soporte: `support_ticket.confirmedAt` — el solicitante confirma que su ticket
 * quedó resuelto (cierre por el usuario) tras marcarse "Hecho". Aditiva/nullable.
 * Idempotente.
 */
export class AddSupportTicketConfirmedAt1786000000049 implements MigrationInterface {
  name = 'AddSupportTicketConfirmedAt1786000000049';

  public async up(q: QueryRunner): Promise<void> {
    const cols = await q.query(`SHOW COLUMNS FROM \`support_ticket\``);
    if (!cols.some((c: any) => c.Field === 'confirmedAt')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`confirmedAt\` DATETIME NULL AFTER \`resolvedAt\``);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const cols = await q.query(`SHOW COLUMNS FROM \`support_ticket\``);
    if (cols.some((c: any) => c.Field === 'confirmedAt')) {
      await q.query(`ALTER TABLE \`support_ticket\` DROP COLUMN \`confirmedAt\``);
    }
  }
}
