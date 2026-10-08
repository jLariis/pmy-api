import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Cierre de ruta, resultados del día siguiente (decisión del usuario 2026-10-08, salida Vía Larga
 * 929567984667: entregados y DEX que FedEx reporta al día siguiente se quedaban "en ruta"):
 *  - `subsidiary.closureUntilNextDispatch`: el cierre cuenta lo que pasó desde el día de la ruta
 *    hasta que la guía sale en otra ruta (no solo el día de la ruta). Seed: Vía Larga, Caborca,
 *    Sonoyta, Puerto Peñasco y Santa Ana (nombre exacto + isWarehouse = 0).
 *  - `package_dispatch_history.closureStatus/closureExceptionCode/closureStatusAt/closureFixedById/
 *    closureFixedAt`: arreglo manual del superadmin ("Paquetes con problema") del estatus con el
 *    que ESTA salida cierra la guía. No toca el estatus vivo.
 *  - Índice `idx_charge_shipment_trackingNumber`: la ventana busca la siguiente salida por número
 *    de guía (shipment ya tenía el suyo).
 *
 * DEFENSIVA: guard a information_schema (evita "duplicate column" si DB_SYNC ya la agregó).
 */
export class ClosureUntilNextDispatch1786000000097 implements MigrationInterface {
  name = 'ClosureUntilNextDispatch1786000000097'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  private readonly historyColumns: [string, string][] = [
    ['closureStatus', 'varchar(64) NULL'],
    ['closureExceptionCode', 'varchar(16) NULL'],
    ['closureStatusAt', 'datetime NULL'],
    ['closureFixedById', 'varchar(36) NULL'],
    ['closureFixedAt', 'datetime NULL'],
  ];

  private async indexExists(qr: QueryRunner, table: string, index: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, index],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.indexExists(queryRunner, 'charge_shipment', 'idx_charge_shipment_trackingNumber'))) {
      await queryRunner.query(
        `CREATE INDEX \`idx_charge_shipment_trackingNumber\` ON \`charge_shipment\` (\`trackingNumber\`)`,
      );
    }
    if (!(await this.columnExists(queryRunner, 'subsidiary', 'closureUntilNextDispatch'))) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` ADD COLUMN \`closureUntilNextDispatch\` tinyint(1) NOT NULL DEFAULT 0`,
      );
    }
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`closureUntilNextDispatch\` = 1
       WHERE \`name\` IN ('Via Larga', 'Caborca', 'Sonoyta', 'Puerto Peñasco', 'Santa Ana') AND \`isWarehouse\` = 0`,
    );
    for (const [col, def] of this.historyColumns) {
      if (!(await this.columnExists(queryRunner, 'package_dispatch_history', col))) {
        await queryRunner.query(`ALTER TABLE \`package_dispatch_history\` ADD COLUMN \`${col}\` ${def}`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.indexExists(queryRunner, 'charge_shipment', 'idx_charge_shipment_trackingNumber')) {
      await queryRunner.query(`DROP INDEX \`idx_charge_shipment_trackingNumber\` ON \`charge_shipment\``);
    }
    for (const [col] of [...this.historyColumns].reverse()) {
      if (await this.columnExists(queryRunner, 'package_dispatch_history', col)) {
        await queryRunner.query(`ALTER TABLE \`package_dispatch_history\` DROP COLUMN \`${col}\``);
      }
    }
    if (await this.columnExists(queryRunner, 'subsidiary', 'closureUntilNextDispatch')) {
      await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`closureUntilNextDispatch\``);
    }
  }
}
