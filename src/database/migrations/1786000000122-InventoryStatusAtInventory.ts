import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estatus de cada paquete AL MOMENTO del inventario (Operaciones → Inventarios → detalle).
 * Antes el detalle mostraba solo el estatus de hoy (un paquete ya entregado aparecía como
 * entregado dentro de un inventario de bodega). Se llena al guardar el inventario; los
 * inventarios anteriores quedan en NULL y el detalle muestra solo el estatus actual.
 *
 * 122 (no 120/121): esos números ya los usa la rama feat/salidas-rediseno.
 */
export class InventoryStatusAtInventory1786000000122 implements MigrationInterface {
  name = 'InventoryStatusAtInventory1786000000122';

  private async addIfMissing(q: QueryRunner, table: string) {
    const rows: any[] = await q.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'statusAtInventory'`,
      [table],
    );
    if (Number(rows?.[0]?.n) > 0) return;
    await q.query(`ALTER TABLE \`${table}\` ADD COLUMN \`statusAtInventory\` varchar(64) NULL`);
  }

  public async up(q: QueryRunner): Promise<void> {
    await this.addIfMissing(q, 'inventory_shipment');
    await this.addIfMissing(q, 'inventory_charge_shipments');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `inventory_shipment` DROP COLUMN `statusAtInventory`');
    await q.query('ALTER TABLE `inventory_charge_shipments` DROP COLUMN `statusAtInventory`');
  }
}
