import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Cierre de ruta, entregas de otro día:
 *  - `subsidiary.closureAcceptsAnyDayDelivery`: si está activo, una guía YA ENTREGADA cuenta
 *    como entregada en el cierre aunque la entrega haya sido antes o después del día de la ruta
 *    (solo entregados). Default false = regla del día de la ruta.
 *  - Seed: activo SOLO para Loreto (decisión del usuario 2026-10-07, ruta 152171165233); se
 *    excluye "Bodega Loreto" (nombre exacto + guard isWarehouse = 0).
 *
 * DEFENSIVA: guard a information_schema (evita "duplicate column" si DB_SYNC ya la agregó).
 */
export class AddClosureAcceptsAnyDayDelivery1786000000095 implements MigrationInterface {
  name = 'AddClosureAcceptsAnyDayDelivery1786000000095'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'subsidiary', 'closureAcceptsAnyDayDelivery'))) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` ADD COLUMN \`closureAcceptsAnyDayDelivery\` tinyint(1) NOT NULL DEFAULT 0`,
      );
    }
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`closureAcceptsAnyDayDelivery\` = 1
       WHERE \`name\` = 'Loreto' AND \`isWarehouse\` = 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'subsidiary', 'closureAcceptsAnyDayDelivery')) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` DROP COLUMN \`closureAcceptsAnyDayDelivery\``,
      );
    }
  }
}
