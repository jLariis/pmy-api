import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baja del estado de reciclaje de quota 17TRACK en `shipment`. El tracking DHL pasó
 * a la API oficial de DHL (sin registro/quota/webhooks), así que estas columnas y su
 * índice quedan obsoletos. Espejo inverso de `AddShipmentSeventeenTrackState1786000000011`.
 */
export class DropShipmentSeventeenTrackState1786000000070 implements MigrationInterface {
  name = 'DropShipmentSeventeenTrackState1786000000070';

  public async up(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX `idx_shipment_seventeen` ON `shipment`').catch(() => undefined);
    const table = await q.getTable('shipment');
    if (table?.findColumnByName('seventeenReleasedAt')) {
      await q.query('ALTER TABLE `shipment` DROP COLUMN `seventeenReleasedAt`').catch(() => undefined);
    }
    if (table?.findColumnByName('seventeenRegisteredAt')) {
      await q.query('ALTER TABLE `shipment` DROP COLUMN `seventeenRegisteredAt`').catch(() => undefined);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const table = await q.getTable('shipment');
    if (!table?.findColumnByName('seventeenRegisteredAt')) {
      await q.query('ALTER TABLE `shipment` ADD COLUMN `seventeenRegisteredAt` DATETIME NULL');
    }
    if (!table?.findColumnByName('seventeenReleasedAt')) {
      await q.query('ALTER TABLE `shipment` ADD COLUMN `seventeenReleasedAt` DATETIME NULL');
    }
    await q.query(
      'CREATE INDEX `idx_shipment_seventeen` ON `shipment` (`seventeenRegisteredAt`, `seventeenReleasedAt`)',
    ).catch(() => undefined);
  }
}
