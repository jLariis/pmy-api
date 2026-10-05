import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aviso por WhatsApp cuando alguien sube guías desde la Bandeja de correos:
 * interruptor y grupos destino (si no hay grupos, se buscan por nombre).
 */
export class AddUploadNotifyGroups1786000000092 implements MigrationInterface {
  name = 'AddUploadNotifyGroups1786000000092';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('ops_alert_settings', 'uploadNotifyEnabled'))) {
      await q.query('ALTER TABLE `ops_alert_settings` ADD `uploadNotifyEnabled` tinyint(1) NOT NULL DEFAULT 1, ADD `uploadNotifyGroups` json NULL');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('ops_alert_settings', 'uploadNotifyEnabled')) {
      await q.query('ALTER TABLE `ops_alert_settings` DROP COLUMN `uploadNotifyEnabled`, DROP COLUMN `uploadNotifyGroups`');
    }
  }
}
