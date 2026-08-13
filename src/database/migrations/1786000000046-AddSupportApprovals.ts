import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soporte v3 — D: autorizadores por zona + flujo de aprobación.
 * - Tabla `support_zone_authorizer` (zona → usuario autorizador).
 * - Columnas de aprobación en `support_ticket` (todas aditivas/nullable).
 * Idempotente.
 */
export class AddSupportApprovals1786000000046 implements MigrationInterface {
  name = 'AddSupportApprovals1786000000046';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`support_zone_authorizer\` (
        \`id\` char(36) NOT NULL,
        \`zoneId\` char(36) NOT NULL,
        \`userId\` char(36) NOT NULL,
        \`userName\` varchar(160) NULL,
        \`userEmail\` varchar(160) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_support_zone_authorizer_zoneId\` (\`zoneId\`),
        UNIQUE KEY \`UQ_support_zone_authorizer_zone_user\` (\`zoneId\`, \`userId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const cols = await q.query(`SHOW COLUMNS FROM \`support_ticket\``);
    const has = (name: string) => cols.some((c: any) => c.Field === name);

    if (!has('approvalStatus')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`approvalStatus\` VARCHAR(20) NOT NULL DEFAULT 'no_requiere' AFTER \`resolvedAt\``);
    }
    if (!has('approvedById')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`approvedById\` CHAR(36) NULL AFTER \`approvalStatus\``);
    }
    if (!has('approvedByName')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`approvedByName\` VARCHAR(160) NULL AFTER \`approvedById\``);
    }
    if (!has('approvalAt')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`approvalAt\` DATETIME NULL AFTER \`approvedByName\``);
    }
    if (!has('approvalNote')) {
      await q.query(`ALTER TABLE \`support_ticket\` ADD COLUMN \`approvalNote\` TEXT NULL AFTER \`approvalAt\``);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const cols = await q.query(`SHOW COLUMNS FROM \`support_ticket\``);
    const has = (name: string) => cols.some((c: any) => c.Field === name);
    for (const col of ['approvalNote', 'approvalAt', 'approvedByName', 'approvedById', 'approvalStatus']) {
      if (has(col)) await q.query(`ALTER TABLE \`support_ticket\` DROP COLUMN \`${col}\``);
    }
    await q.query(`DROP TABLE IF EXISTS \`support_zone_authorizer\``);
  }
}
