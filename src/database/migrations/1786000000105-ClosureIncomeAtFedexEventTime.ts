import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Cierre de ruta, fecha de los ingresos (decisión del usuario 2026-10-10, guía 383934388357 de la
 * ruta 152171165233 de Loreto: salió el 06-oct, se entregó el 07-oct y el ingreso quedó el 06):
 *  - `subsidiary.closureIncomeAtFedexEventTime`: si está activo, el cierre de ruta cobra cada guía
 *    con la fecha y hora EXACTA del evento FedEx guardado en `shipment_status.timestamp` (entrega o
 *    DEX), aunque sea de un día posterior al de la ruta. Nunca usa el día de la ruta como fecha.
 *    Default false = regla actual (solo eventos del día de la ruta).
 *  - Seed: activo SOLO para Loreto; se excluye "Bodega Loreto" (nombre exacto + isWarehouse = 0).
 *
 * DEFENSIVA: guard a information_schema (evita "duplicate column" si DB_SYNC ya la agregó).
 */
export class ClosureIncomeAtFedexEventTime1786000000105 implements MigrationInterface {
  name = 'ClosureIncomeAtFedexEventTime1786000000105'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'subsidiary', 'closureIncomeAtFedexEventTime'))) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` ADD COLUMN \`closureIncomeAtFedexEventTime\` tinyint(1) NOT NULL DEFAULT 0`,
      );
    }
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`closureIncomeAtFedexEventTime\` = 1
       WHERE \`name\` = 'Loreto' AND \`isWarehouse\` = 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'subsidiary', 'closureIncomeAtFedexEventTime')) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` DROP COLUMN \`closureIncomeAtFedexEventTime\``,
      );
    }
  }
}
