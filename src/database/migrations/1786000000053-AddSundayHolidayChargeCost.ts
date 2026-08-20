import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Sobreprecio de cobro de cargas en DOMINGO / DÍA FESTIVO (por sucursal):
 *  - `subsidiary.chargeCostSundayHoliday`: sobreprecio de carga F2 normal (0 = no aplica).
 *  - `subsidiary.chargeCostHalfTonSundayHoliday`: sobreprecio de carga 1.5 ton (0 = no aplica).
 *
 * Seed exclusivo Hermosillo:
 *  - chargeCostSundayHoliday = 6660 (F2 en domingo/festivo).
 *  - chargeCostHalfTonSundayHoliday = 6004 (1.5 ton en domingo/festivo).
 *  - Además la base de 1.5 ton sube 3900 → 4228 (solo si sigue en 3900, para no pisar
 *    ediciones manuales posteriores).
 *
 * DEFENSIVA: guards a information_schema por el historial de `synchronize` del proyecto.
 */
export class AddSundayHolidayChargeCost1786000000053 implements MigrationInterface {
  name = 'AddSundayHolidayChargeCost1786000000053'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'subsidiary', 'chargeCostSundayHoliday'))) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` ADD COLUMN \`chargeCostSundayHoliday\` decimal(10,2) NOT NULL DEFAULT '0.00'`,
      );
    }

    if (!(await this.columnExists(queryRunner, 'subsidiary', 'chargeCostHalfTonSundayHoliday'))) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` ADD COLUMN \`chargeCostHalfTonSundayHoliday\` decimal(10,2) NOT NULL DEFAULT '0.00'`,
      );
    }

    // Seed exclusivo Hermosillo. Solo si siguen en 0 para no pisar ediciones manuales.
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`chargeCostSundayHoliday\` = 6660
       WHERE \`name\` LIKE '%Hermosillo%' AND \`chargeCostSundayHoliday\` = 0`,
    );
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`chargeCostHalfTonSundayHoliday\` = 6004
       WHERE \`name\` LIKE '%Hermosillo%' AND \`chargeCostHalfTonSundayHoliday\` = 0`,
    );

    // Base 1.5 ton de Hermosillo: 3900 → 4228 (solo si sigue en el valor sembrado).
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`chargeCostHalfTon\` = 4228
       WHERE \`name\` LIKE '%Hermosillo%' AND \`chargeCostHalfTon\` = 3900`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'subsidiary', 'chargeCostHalfTonSundayHoliday')) {
      await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`chargeCostHalfTonSundayHoliday\``);
    }
    if (await this.columnExists(queryRunner, 'subsidiary', 'chargeCostSundayHoliday')) {
      await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`chargeCostSundayHoliday\``);
    }
    // La base 1.5 ton (4228) NO se revierte automáticamente (no distinguimos edición manual).
  }
}
