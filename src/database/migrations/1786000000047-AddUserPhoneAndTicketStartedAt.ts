import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soporte: `user.phone` (para notificar por WhatsApp al creador del ticket) y
 * `support_ticket.startedAt` (inicio de trabajo, para medir el tiempo trabajado).
 * Aditivas/nullable. Idempotente.
 */
export class AddUserPhoneAndTicketStartedAt1786000000047 implements MigrationInterface {
  name = 'AddUserPhoneAndTicketStartedAt1786000000047';

  private async has(q: QueryRunner, table: string, col: string): Promise<boolean> {
    const cols = await q.query(`SHOW COLUMNS FROM \`${table}\``);
    return cols.some((c: any) => c.Field === col);
  }

  public async up(q: QueryRunner): Promise<void> {
    if (!(await this.has(q, 'user', 'phone'))) {
      await q.query(`ALTER TABLE \`user\` ADD COLUMN \`phone\` VARCHAR(30) NULL AFTER \`avatar\``);
    }
    if (!(await this.has(q, 'support_ticket', 'startedAt'))) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`startedAt\` DATETIME NULL AFTER \`updatedAt\``);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await this.has(q, 'support_ticket', 'startedAt')) {
      await q.query(`ALTER TABLE \`support_ticket\` DROP COLUMN \`startedAt\``);
    }
    if (await this.has(q, 'user', 'phone')) {
      await q.query(`ALTER TABLE \`user\` DROP COLUMN \`phone\``);
    }
  }
}
