import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega `kind` ('shipment' | 'charge') a tracking_sync_observation para distinguir
 * normales de F2 (charge_shipment) en el shadow. Nullable → filas viejas quedan NULL.
 */
export class AddKindToTrackingSyncObservation1786000000013 implements MigrationInterface {
  name = 'AddKindToTrackingSyncObservation1786000000013';

  public async up(q: QueryRunner): Promise<void> {
    const table = await q.getTable('tracking_sync_observation');
    if (table && !table.findColumnByName('kind')) {
      await q.query('ALTER TABLE `tracking_sync_observation` ADD COLUMN `kind` VARCHAR(16) NULL');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `tracking_sync_observation` DROP COLUMN `kind`').catch(() => undefined);
  }
}
