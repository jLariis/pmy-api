import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inventarios: guías escaneadas que NO entraron al inventario (no existen en el sistema,
 * son de otra sucursal o tienen formato inválido), con su motivo. Antes el front las mandaba
 * como `missingTrackings`/`unScannedTrackings` pero la tabla no tenía dónde guardarlas y se
 * perdían. JSON: [{ trackingNumber, reason, kind }].
 */
export class InventoryRejectedTrackings1786000000104 implements MigrationInterface {
  name = 'InventoryRejectedTrackings1786000000104';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('inventory', 'rejectedTrackings'))) {
      await q.query('ALTER TABLE `inventory` ADD `rejectedTrackings` json NULL');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('inventory', 'rejectedTrackings')) {
      await q.query('ALTER TABLE `inventory` DROP COLUMN `rejectedTrackings`');
    }
  }
}
