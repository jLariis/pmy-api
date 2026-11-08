import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `subsidiary.dispatchScreenV2`: la sucursal arma sus salidas a ruta con la pantalla nueva
 * (escáner primero, confirmación, avance por pasos y "Salida lista"). Default 0 = pantalla de
 * siempre. Arranque por etapas: se prende solo en Cabo San Lucas.
 */
export class DispatchScreenV21786000000121 implements MigrationInterface {
  name = 'DispatchScreenV21786000000121';
  private static readonly CABO_SAN_LUCAS_ID = 'abf2fc38-cb42-41b6-9554-4b71c11b8916';

  public async up(q: QueryRunner): Promise<void> {
    const col: any[] = await q.query("SHOW COLUMNS FROM `subsidiary` LIKE 'dispatchScreenV2'");
    if (col.length === 0) {
      await q.query('ALTER TABLE `subsidiary` ADD COLUMN `dispatchScreenV2` TINYINT(1) NOT NULL DEFAULT 0');
    }
    await q.query('UPDATE `subsidiary` SET `dispatchScreenV2` = 1 WHERE `id` = ?', [DispatchScreenV21786000000121.CABO_SAN_LUCAS_ID]);
  }

  public async down(q: QueryRunner): Promise<void> {
    const col: any[] = await q.query("SHOW COLUMNS FROM `subsidiary` LIKE 'dispatchScreenV2'");
    if (col.length > 0) await q.query('ALTER TABLE `subsidiary` DROP COLUMN `dispatchScreenV2`');
  }
}
