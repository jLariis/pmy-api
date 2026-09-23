import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rediseño v2: la solicitud pasa a ser el "expediente" de mantenimiento con folio `MT-000001`
 * (antes `SM-`). Crea el contador MT continuando el de SM y renombra los folios existentes.
 */
export class MaintenanceExpedienteFolio1786000000077 implements MigrationInterface {
  name = 'MaintenanceExpedienteFolio1786000000077';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT IGNORE INTO \`maintenance_folio_counter\` (\`prefix\`, \`lastValue\`)
      SELECT 'MT', COALESCE((SELECT \`lastValue\` FROM \`maintenance_folio_counter\` WHERE \`prefix\` = 'SM'), 0)
    `);
    await q.query("UPDATE `maintenance_request` SET `folio` = CONCAT('MT-', SUBSTRING(`folio`, 4)) WHERE `folio` LIKE 'SM-%'");
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query("UPDATE `maintenance_request` SET `folio` = CONCAT('SM-', SUBSTRING(`folio`, 4)) WHERE `folio` LIKE 'MT-%'");
    await q.query("DELETE FROM `maintenance_folio_counter` WHERE `prefix` = 'MT'");
  }
}
