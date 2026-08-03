import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soporte v2: agrega columnas para SLA y el email del asignado a `support_ticket`.
 * - `assigneeEmail`: denormalizado del agente asignado (auto-asignación default).
 * - `slaDueAt`: fecha límite de resolución = createdAt + horas(prioridad).
 * - `slaNotifiedAt`: marca de aviso de SLA vencido (evita duplicar el correo del cron).
 * Los estados nuevos (`por_hacer`, `en_revision`) no requieren cambio de esquema:
 * `estado` ya es VARCHAR(20) y solo amplía sus valores permitidos en el DTO.
 */
export class AddSupportSlaAndAssigneeEmail1786000000042 implements MigrationInterface {
  name = 'AddSupportSlaAndAssigneeEmail1786000000042';

  public async up(q: QueryRunner): Promise<void> {
    const cols = await q.query(`SHOW COLUMNS FROM \`support_ticket\``);
    const has = (name: string) => cols.some((c: any) => c.Field === name);

    if (!has('assigneeEmail')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`assigneeEmail\` VARCHAR(160) NULL AFTER \`assigneeName\``);
    }
    if (!has('slaDueAt')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`slaDueAt\` DATETIME NULL AFTER \`resolvedAt\``);
    }
    if (!has('slaNotifiedAt')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`slaNotifiedAt\` DATETIME NULL AFTER \`slaDueAt\``);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const cols = await q.query(`SHOW COLUMNS FROM \`support_ticket\``);
    const has = (name: string) => cols.some((c: any) => c.Field === name);
    if (has('slaNotifiedAt')) await q.query(`ALTER TABLE \`support_ticket\` DROP COLUMN \`slaNotifiedAt\``);
    if (has('slaDueAt')) await q.query(`ALTER TABLE \`support_ticket\` DROP COLUMN \`slaDueAt\``);
    if (has('assigneeEmail')) await q.query(`ALTER TABLE \`support_ticket\` DROP COLUMN \`assigneeEmail\``);
  }
}
