import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Flag por sucursal: ordenar las salidas a ruta por código postal.
 * Si está activo, el escaneo / PDF / Excel de package-dispatch ordenan los
 * paquetes por `recipientZip`; si no, se conserva el orden de escaneo.
 */
export class AddSubsidiarySortDispatchByCp1786000000012 implements MigrationInterface {
  name = 'AddSubsidiarySortDispatchByCp1786000000012';

  public async up(q: QueryRunner): Promise<void> {
    const exists: any[] = await q.query("SHOW COLUMNS FROM `subsidiary` LIKE 'sortDispatchByPostalCode'");
    if (exists.length === 0) {
      await q.query('ALTER TABLE `subsidiary` ADD COLUMN `sortDispatchByPostalCode` TINYINT(1) NOT NULL DEFAULT 0');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const exists: any[] = await q.query("SHOW COLUMNS FROM `subsidiary` LIKE 'sortDispatchByPostalCode'");
    if (exists.length > 0) {
      await q.query('ALTER TABLE `subsidiary` DROP COLUMN `sortDispatchByPostalCode`');
    }
  }
}
