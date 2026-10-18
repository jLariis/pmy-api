import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Devoluciones por REGISTRO (2026-10-17, caso 384096861505): la persona elige qué registro de la
 * guía se devuelve y se guarda qué cambió para poder deshacerlo con autorización.
 *  - `shipmentId` / `chargeShipmentId`: registro elegido.
 *  - `appliedChanges`: registros marcados (con su estatus anterior) e ingresos anulados.
 *  - `undoneAt` / `undoneById` / `undoReason`: deshecha con autorización.
 *
 * DEFENSIVA: guard a information_schema (no falla si DB_SYNC ya las agregó).
 */
export class DevolutionChosenRecord1786000000108 implements MigrationInterface {
  name = 'DevolutionChosenRecord1786000000108'

  private readonly columns: [string, string][] = [
    ['shipmentId', 'varchar(36) NULL DEFAULT NULL'],
    ['chargeShipmentId', 'varchar(36) NULL DEFAULT NULL'],
    ['appliedChanges', 'json NULL DEFAULT NULL'],
    ['undoneAt', 'datetime NULL DEFAULT NULL'],
    ['undoneById', 'char(36) NULL DEFAULT NULL'],
    ['undoReason', 'text NULL DEFAULT NULL'],
  ];

  private async columnExists(qr: QueryRunner, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'devolution' AND COLUMN_NAME = ?`,
      [column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, type] of this.columns) {
      if (!(await this.columnExists(queryRunner, name))) {
        await queryRunner.query(`ALTER TABLE \`devolution\` ADD COLUMN \`${name}\` ${type}`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name] of [...this.columns].reverse()) {
      if (await this.columnExists(queryRunner, name)) {
        await queryRunner.query(`ALTER TABLE \`devolution\` DROP COLUMN \`${name}\``);
      }
    }
  }
}
