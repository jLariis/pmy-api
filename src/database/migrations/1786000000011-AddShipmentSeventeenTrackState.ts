import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estado de reciclaje de quota 17TRACK para DHL en `shipment`:
 * - seventeenRegisteredAt: cuándo se registró en 17TRACK (consume 1 slot de quota).
 * - seventeenReleasedAt: cuándo se borró de 17TRACK (deletetrack) al llegar a
 *   estatus terminal, liberando el slot para reutilizarlo.
 * Activo en 17TRACK ⇔ registeredAt != null AND releasedAt == null.
 */
export class AddShipmentSeventeenTrackState1786000000011 implements MigrationInterface {
  name = 'AddShipmentSeventeenTrackState1786000000011';

  public async up(q: QueryRunner): Promise<void> {
    const table = await q.getTable('shipment');
    if (!table?.findColumnByName('seventeenRegisteredAt')) {
      await q.query('ALTER TABLE `shipment` ADD COLUMN `seventeenRegisteredAt` DATETIME NULL');
    }
    if (!table?.findColumnByName('seventeenReleasedAt')) {
      await q.query('ALTER TABLE `shipment` ADD COLUMN `seventeenReleasedAt` DATETIME NULL');
    }
    // Índice para que el cron filtre rápido los activos en 17TRACK.
    await q.query(
      'CREATE INDEX `idx_shipment_seventeen` ON `shipment` (`seventeenRegisteredAt`, `seventeenReleasedAt`)',
    ).catch(() => undefined);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX `idx_shipment_seventeen` ON `shipment`').catch(() => undefined);
    await q.query('ALTER TABLE `shipment` DROP COLUMN `seventeenReleasedAt`').catch(() => undefined);
    await q.query('ALTER TABLE `shipment` DROP COLUMN `seventeenRegisteredAt`').catch(() => undefined);
  }
}
