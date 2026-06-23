import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Convierte los flags por-sucursal que estaban HARDCODEADOS en el backend
 * (`SUBSIDIARY_CONFIG` de monitoring y shipments) en configuración real por
 * sucursal. Agrega columnas con nombres descriptivos y BACKFILLEA los valores
 * que estaban en código.
 *
 * Mapeo desde los nombres viejos del código:
 *  shouldCheck67        → monitorFedexCode67
 *  shouldCheck44        → monitorFedexCode44
 *  trackExternalDelivery→ trackFedexExternalDelivery
 *  forceFedexStatus     → forceFedexStatusOverride
 */
export class AddSubsidiaryConfigFlags1786000000007 implements MigrationInterface {
  name = 'AddSubsidiaryConfigFlags1786000000007';

  private cols = ['monitorFedexCode67', 'monitorFedexCode44', 'trackFedexExternalDelivery', 'forceFedexStatusOverride'];

  public async up(q: QueryRunner): Promise<void> {
    for (const c of this.cols) {
      const exists: any[] = await q.query(`SHOW COLUMNS FROM \`subsidiary\` LIKE '${c}'`);
      if (exists.length === 0) {
        await q.query(`ALTER TABLE \`subsidiary\` ADD COLUMN \`${c}\` TINYINT(1) NOT NULL DEFAULT 0`);
      }
    }

    // Backfill de los valores hardcodeados (monitoring + shipments SUBSIDIARY_CONFIG).
    // Cabo San Lucas
    await q.query(
      `UPDATE \`subsidiary\` SET \`monitorFedexCode67\` = 1, \`trackFedexExternalDelivery\` = 1, \`forceFedexStatusOverride\` = 1 WHERE \`id\` = ?`,
      ['abf2fc38-cb42-41b6-9554-4b71c11b8916'],
    );
    await q.query(`UPDATE \`subsidiary\` SET \`monitorFedexCode44\` = 1 WHERE \`id\` IN (?, ?)`, [
      'b45cbb94-84e0-481f-bbf8-75642b601230',
      '040483fc-4322-4ce0-b124-cc5b6d2a9cee',
    ]);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const c of this.cols) {
      const exists: any[] = await q.query(`SHOW COLUMNS FROM \`subsidiary\` LIKE '${c}'`);
      if (exists.length > 0) await q.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`${c}\``);
    }
  }
}
