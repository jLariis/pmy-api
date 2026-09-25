import { MigrationInterface, QueryRunner } from 'typeorm';

/** Compras v3: la orden de compra de una solicitud tipo "compra" puede no tener unidad. Sin COLLATE explícito. */
export class PurchaseOrderVehicleOptional1786000000082 implements MigrationInterface {
  name = 'PurchaseOrderVehicleOptional1786000000082';

  public async up(q: QueryRunner): Promise<void> {
    const [col] = await q.query(
      "SELECT IS_NULLABLE AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'purchase_order' AND column_name = 'vehicleId'",
    );
    if (col?.n === 'NO') await q.query('ALTER TABLE `purchase_order` MODIFY `vehicleId` varchar(36) NULL');
  }

  public async down(q: QueryRunner): Promise<void> {
    // Solo se puede volver a NOT NULL si ninguna orden quedó sin unidad.
    const [row] = await q.query('SELECT COUNT(*) AS n FROM `purchase_order` WHERE `vehicleId` IS NULL');
    if (Number(row?.n) === 0) await q.query('ALTER TABLE `purchase_order` MODIFY `vehicleId` varchar(36) NOT NULL');
  }
}
