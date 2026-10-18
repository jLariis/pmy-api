import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Cierre de ruta lento al abrir (2026-10-17): "¿esta guía ya tiene ingreso?" filtra
 * `shipmentId = X OR (shipmentId IS NULL AND trackingNumber = T)` y MySQL recorría las ~29 mil
 * filas de income sin shipment por guía. Con (shipmentId, trackingNumber) son 2 filas: abrir un
 * cierre de 75 guías bajó de ~100 s a unos segundos.
 *
 * DEFENSIVA: guard a information_schema (no falla si el índice ya existe).
 */
export class IncomeShipmentTrackingIndex1786000000107 implements MigrationInterface {
  name = 'IncomeShipmentTrackingIndex1786000000107'

  private async indexExists(qr: QueryRunner): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'income' AND INDEX_NAME = 'idx_income_shipment_tracking'`,
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.indexExists(queryRunner))) {
      await queryRunner.query(`CREATE INDEX \`idx_income_shipment_tracking\` ON \`income\` (\`shipmentId\`, \`trackingNumber\`)`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.indexExists(queryRunner)) {
      await queryRunner.query(`DROP INDEX \`idx_income_shipment_tracking\` ON \`income\``);
    }
  }
}
