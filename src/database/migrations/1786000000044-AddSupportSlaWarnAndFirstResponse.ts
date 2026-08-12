import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soporte v3: columnas de aviso preventivo de SLA y SLA de primera respuesta en
 * `support_ticket`.
 * - `slaWarnAt` / `slaWarnedAt`: umbral y marca del aviso preventivo (≈80% del SLA).
 * - `firstResponseDueAt` / `firstRespondedAt` / `firstResponseNotifiedAt`: SLA de
 *   primera respuesta (fecha límite, sello de la primera acción del agente, marca
 *   de aviso vencido del cron).
 * Todas nullable y aditivas; datos existentes siguen válidos. Idempotente.
 */
export class AddSupportSlaWarnAndFirstResponse1786000000044 implements MigrationInterface {
  name = 'AddSupportSlaWarnAndFirstResponse1786000000044';

  public async up(q: QueryRunner): Promise<void> {
    const cols = await q.query(`SHOW COLUMNS FROM \`support_ticket\``);
    const has = (name: string) => cols.some((c: any) => c.Field === name);

    if (!has('slaWarnAt')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`slaWarnAt\` DATETIME NULL AFTER \`slaDueAt\``);
    }
    if (!has('slaWarnedAt')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`slaWarnedAt\` DATETIME NULL AFTER \`slaWarnAt\``);
    }
    if (!has('firstResponseDueAt')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`firstResponseDueAt\` DATETIME NULL AFTER \`slaNotifiedAt\``);
    }
    if (!has('firstRespondedAt')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`firstRespondedAt\` DATETIME NULL AFTER \`firstResponseDueAt\``);
    }
    if (!has('firstResponseNotifiedAt')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`firstResponseNotifiedAt\` DATETIME NULL AFTER \`firstRespondedAt\``);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const cols = await q.query(`SHOW COLUMNS FROM \`support_ticket\``);
    const has = (name: string) => cols.some((c: any) => c.Field === name);

    if (has('firstResponseNotifiedAt')) await q.query(`ALTER TABLE \`support_ticket\` DROP COLUMN \`firstResponseNotifiedAt\``);
    if (has('firstRespondedAt')) await q.query(`ALTER TABLE \`support_ticket\` DROP COLUMN \`firstRespondedAt\``);
    if (has('firstResponseDueAt')) await q.query(`ALTER TABLE \`support_ticket\` DROP COLUMN \`firstResponseDueAt\``);
    if (has('slaWarnedAt')) await q.query(`ALTER TABLE \`support_ticket\` DROP COLUMN \`slaWarnedAt\``);
    if (has('slaWarnAt')) await q.query(`ALTER TABLE \`support_ticket\` DROP COLUMN \`slaWarnAt\``);
  }
}
