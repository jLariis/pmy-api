import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bandeja de correos: "¿ya se subió?" por GUÍAS (no por número de consolidado).
 * - inbox_attachment.systemMatch: por hoja/archivo, cuántas guías ya están y en qué consolidados.
 * - inbox_message.uploadCoverage: resumen del correo (ninguno / parcial / completo) para filtros.
 */
export class AddInboxSystemMatch1786000000094 implements MigrationInterface {
  name = 'AddInboxSystemMatch1786000000094';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('inbox_attachment', 'systemMatch'))) {
      await q.query('ALTER TABLE `inbox_attachment` ADD `systemMatch` json NULL');
    }
    if (!(await q.hasColumn('inbox_message', 'uploadCoverage'))) {
      await q.query('ALTER TABLE `inbox_message` ADD `uploadCoverage` varchar(10) NULL, ADD `matchedAt` datetime NULL, ADD KEY `IDX_inbox_message_coverage` (`uploadCoverage`)');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('inbox_message', 'uploadCoverage')) {
      await q.query('ALTER TABLE `inbox_message` DROP KEY `IDX_inbox_message_coverage`, DROP COLUMN `uploadCoverage`, DROP COLUMN `matchedAt`');
    }
    if (await q.hasColumn('inbox_attachment', 'systemMatch')) await q.query('ALTER TABLE `inbox_attachment` DROP COLUMN `systemMatch`');
  }
}
