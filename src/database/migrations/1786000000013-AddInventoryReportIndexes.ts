import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índices para el reporte de Inventarios (y de paso para los agregados del 67):
 * - inventory(subsidiaryId, inventoryDate): filtro principal del reporte.
 * - shipment_status(shipmentId, exceptionCode, timestamp): MAX(timestamp) del 67
 *   por envío (WHERE shipmentId IN ... AND exceptionCode='67').
 * - shipment_status(chargeShipmentId, exceptionCode, timestamp): idem para cargas.
 * Idempotente: cada CREATE INDEX ignora el error si el índice ya existe.
 */
export class AddInventoryReportIndexes1786000000013 implements MigrationInterface {
  name = 'AddInventoryReportIndexes1786000000013';

  private readonly indexes: { name: string; sql: string }[] = [
    { name: 'idx_inventory_sub_date', sql: 'CREATE INDEX `idx_inventory_sub_date` ON `inventory` (`subsidiaryId`, `inventoryDate`)' },
    { name: 'idx_ss_shipment_exc_ts', sql: 'CREATE INDEX `idx_ss_shipment_exc_ts` ON `shipment_status` (`shipmentId`, `exceptionCode`, `timestamp`)' },
    { name: 'idx_ss_charge_exc_ts', sql: 'CREATE INDEX `idx_ss_charge_exc_ts` ON `shipment_status` (`chargeShipmentId`, `exceptionCode`, `timestamp`)' },
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const idx of this.indexes) {
      await q.query(idx.sql).catch((e: any) => {
        // 1061 = Duplicate key name → ya existe; cualquier otro lo relanzamos.
        if (e?.errno === 1061 || /Duplicate key name/i.test(e?.message || '')) return undefined;
        throw e;
      });
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const idx of this.indexes) {
      const table = idx.sql.includes('`inventory`') ? 'inventory' : 'shipment_status';
      await q.query(`DROP INDEX \`${idx.name}\` ON \`${table}\``).catch(() => undefined);
    }
  }
}
