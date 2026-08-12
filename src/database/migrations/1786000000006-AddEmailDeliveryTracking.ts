import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Trazabilidad y reenvío de correo (piloto en salidas a ruta):
 *  - `email_log`: bitácora genérica, un renglón por intento de envío.
 *  - `email_attachment`: referencia a los archivos guardados en disco (una vez
 *    por entidad); la BD NO guarda los bytes.
 *  - columnas denormalizadas en `package_dispatch` para pintar el botón/tooltip.
 *
 * DEFENSIVA: en este proyecto varias tablas/columnas fueron creadas históricamente por un
 * `synchronize`, no por migración. Por eso se usan `CREATE TABLE IF NOT EXISTS` y guards a
 * information_schema en vez de `CREATE`/`ADD COLUMN` a ciegas (que fallan con "ya existe").
 */
export class AddEmailDeliveryTracking1786000000006 implements MigrationInterface {
  name = 'AddEmailDeliveryTracking1786000000006'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  private async addColumnIfMissing(qr: QueryRunner, table: string, column: string, ddl: string) {
    if (!(await this.columnExists(qr, table, column))) {
      await qr.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`email_log\` (
        \`id\` varchar(36) NOT NULL,
        \`module\` varchar(64) NOT NULL,
        \`emailType\` varchar(64) NOT NULL DEFAULT 'unknown',
        \`entityId\` varchar(36) NOT NULL,
        \`referenceTracking\` varchar(255) NULL,
        \`subsidiaryId\` varchar(36) NULL,
        \`subsidiaryName\` varchar(255) NULL,
        \`to\` text NOT NULL,
        \`cc\` text NULL,
        \`subject\` varchar(255) NOT NULL,
        \`status\` enum('not_sent','sent','error') NOT NULL,
        \`error\` text NULL,
        \`messageId\` varchar(255) NULL,
        \`rejected\` text NULL,
        \`isResend\` tinyint NOT NULL DEFAULT 0,
        \`triggeredById\` varchar(36) NULL,
        \`triggeredByName\` varchar(255) NULL,
        \`attachmentsMeta\` json NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX \`IDX_email_log_entity\` (\`module\`, \`entityId\`, \`createdAt\`),
        INDEX \`IDX_email_log_type\` (\`emailType\`),
        PRIMARY KEY (\`id\`)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`email_attachment\` (
        \`id\` varchar(36) NOT NULL,
        \`module\` varchar(64) NOT NULL,
        \`entityId\` varchar(36) NOT NULL,
        \`filename\` varchar(255) NOT NULL,
        \`mimeType\` varchar(128) NOT NULL,
        \`size\` int NOT NULL,
        \`storagePath\` varchar(512) NOT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX \`IDX_email_attachment_entity\` (\`module\`, \`entityId\`),
        PRIMARY KEY (\`id\`)
      )
    `);

    await this.addColumnIfMissing(
      queryRunner, 'package_dispatch', 'emailStatus',
      "`emailStatus` enum('not_sent','sent','error') NOT NULL DEFAULT 'not_sent'",
    );
    await this.addColumnIfMissing(
      queryRunner, 'package_dispatch', 'emailLastSentAt', '`emailLastSentAt` timestamp NULL',
    );
    await this.addColumnIfMissing(
      queryRunner, 'package_dispatch', 'emailLastError', '`emailLastError` varchar(500) NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const col of ['emailLastError', 'emailLastSentAt', 'emailStatus']) {
      if (await this.columnExists(queryRunner, 'package_dispatch', col)) {
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP COLUMN \`${col}\``);
      }
    }
    await queryRunner.query(`DROP TABLE IF EXISTS \`email_attachment\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`email_log\``);
  }
}
