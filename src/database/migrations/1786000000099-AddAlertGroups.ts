import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Alertas operativas a los grupos GENERALES de WhatsApp (los mismos del aviso de subida:
 * "PMY (Monitoreo)" y "Sistemas PMY"): interruptor y desde qué nivel se mandan
 * (1 vencido · 2 +30 min · 3 +60 min). Un mensaje agrupado por revisión.
 */
export class AddAlertGroups1786000000099 implements MigrationInterface {
  name = 'AddAlertGroups1786000000099';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('ops_alert_settings', 'alertGroupsEnabled'))) {
      await q.query('ALTER TABLE `ops_alert_settings` ADD `alertGroupsEnabled` tinyint(1) NOT NULL DEFAULT 1, ADD `alertGroupsLevel` int NOT NULL DEFAULT 1');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('ops_alert_settings', 'alertGroupsEnabled')) {
      await q.query('ALTER TABLE `ops_alert_settings` DROP COLUMN `alertGroupsEnabled`, DROP COLUMN `alertGroupsLevel`');
    }
  }
}
