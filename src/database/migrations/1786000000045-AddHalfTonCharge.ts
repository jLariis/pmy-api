import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Carga de 1.5 toneladas:
 *  - `subsidiary.chargeCostHalfTon`: costo de carga 1.5 ton por sucursal (0 = no aplica).
 *  - `charge.isHalfTon`: bandera de trazabilidad (el ingreso usó el costo 1.5 ton).
 *  - Seed: Hermosillo = 3900 (solo si sigue en 0, para no pisar configuración manual posterior).
 *
 * DEFENSIVA: guards a information_schema por el historial de `synchronize` del proyecto
 * (evita "duplicate column" si un DB_SYNC ya agregó la columna en dev).
 */
export class AddHalfTonCharge1786000000045 implements MigrationInterface {
  name = 'AddHalfTonCharge1786000000045'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'subsidiary', 'chargeCostHalfTon'))) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` ADD COLUMN \`chargeCostHalfTon\` decimal(10,2) NOT NULL DEFAULT '0.00'`,
      );
    }

    if (!(await this.columnExists(queryRunner, 'charge', 'isHalfTon'))) {
      await queryRunner.query(
        `ALTER TABLE \`charge\` ADD COLUMN \`isHalfTon\` tinyint(1) NOT NULL DEFAULT 0`,
      );
    }

    // Seed exclusivo Hermosillo. Solo si sigue en 0 para no pisar ediciones manuales.
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`chargeCostHalfTon\` = 3900
       WHERE \`name\` LIKE '%Hermosillo%' AND \`chargeCostHalfTon\` = 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'charge', 'isHalfTon')) {
      await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`isHalfTon\``);
    }
    if (await this.columnExists(queryRunner, 'subsidiary', 'chargeCostHalfTon')) {
      await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`chargeCostHalfTon\``);
    }
  }
}
