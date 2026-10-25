import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Salidas a ruta ordenadas por paquetería:
 *  - `subsidiary.sortDispatchByCarrier`: agrupa FedEx (incluye F2) y luego DHL; se
 *    combina con `sortDispatchByPostalCode` (dentro de cada paquetería, CP + dirección).
 *    Se prende en Bodega Obregon junto con el orden por CP.
 *  - `package_dispatch.sortMode`: orden con el que se armó la salida
 *    ('carrier_cp' | 'cp' | 'scan'), para que reenviar/regenerar dé el mismo PDF y Excel.
 *    null = salidas viejas (se usa la config de la sucursal).
 */
export class DispatchSortByCarrier1786000000117 implements MigrationInterface {
  name = 'DispatchSortByCarrier1786000000117';

  public async up(q: QueryRunner): Promise<void> {
    const sub: any[] = await q.query("SHOW COLUMNS FROM `subsidiary` LIKE 'sortDispatchByCarrier'");
    if (sub.length === 0) {
      await q.query('ALTER TABLE `subsidiary` ADD COLUMN `sortDispatchByCarrier` TINYINT(1) NOT NULL DEFAULT 0');
    }
    const pd: any[] = await q.query("SHOW COLUMNS FROM `package_dispatch` LIKE 'sortMode'");
    if (pd.length === 0) {
      await q.query('ALTER TABLE `package_dispatch` ADD COLUMN `sortMode` VARCHAR(16) NULL');
    }
    await q.query(
      "UPDATE `subsidiary` SET `sortDispatchByCarrier` = 1, `sortDispatchByPostalCode` = 1 WHERE `name` IN ('Bodega Obregon', 'Bodega Obregón')",
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    const pd: any[] = await q.query("SHOW COLUMNS FROM `package_dispatch` LIKE 'sortMode'");
    if (pd.length > 0) await q.query('ALTER TABLE `package_dispatch` DROP COLUMN `sortMode`');
    const sub: any[] = await q.query("SHOW COLUMNS FROM `subsidiary` LIKE 'sortDispatchByCarrier'");
    if (sub.length > 0) await q.query('ALTER TABLE `subsidiary` DROP COLUMN `sortDispatchByCarrier`');
  }
}
