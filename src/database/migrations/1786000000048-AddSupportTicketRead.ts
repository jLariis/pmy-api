import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soporte: marca de lectura por usuario/ticket, para señalar comentarios NUEVOS
 * en el tablero. Idempotente.
 */
export class AddSupportTicketRead1786000000048 implements MigrationInterface {
  name = 'AddSupportTicketRead1786000000048';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`support_ticket_read\` (
        \`id\` char(36) NOT NULL,
        \`userId\` char(36) NOT NULL,
        \`ticketId\` varchar(36) NOT NULL,
        \`lastViewedAt\` datetime NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_support_ticket_read_user_ticket\` (\`userId\`, \`ticketId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS \`support_ticket_read\``);
  }
}
