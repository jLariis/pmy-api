import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Segundo abordo en cargas F2/31.5 (por sucursal):
 *  - `subsidiary.chargeSecondAbord` (bit): si está activo, al crear cargas F2/31.5 se SUMA
 *    `secondAbordAmount` al costo NORMAL de la carga (no aplica a 1.5 ton ni al sobreprecio
 *    de domingo/festivo) y ese total va como ingreso.
 *  - `subsidiary.secondAbordAmount` (decimal): monto del segundo abordo. Existía en la entidad
 *    sin migración → esta migración lo asegura para entornos que no lo tengan.
 *
 * Seed exclusivo Hermosillo: chargeSecondAbord = 1. El monto (secondAbordAmount) NO se pisa:
 * ya está capturado en producción y es editable desde Configuración → Sucursales.
 *
 * DEFENSIVA: guards a information_schema por el historial de `synchronize` del proyecto.
 */
export class AddSubsidiaryChargeSecondAbord1786000000057 implements MigrationInterface {
  name = 'AddSubsidiaryChargeSecondAbord1786000000057'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // secondAbordAmount nunca tuvo migración: asegúralo para dev/entornos sin él.
    if (!(await this.columnExists(queryRunner, 'subsidiary', 'secondAbordAmount'))) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` ADD COLUMN \`secondAbordAmount\` decimal(10,2) NOT NULL DEFAULT '0.00'`,
      );
    }

    if (!(await this.columnExists(queryRunner, 'subsidiary', 'chargeSecondAbord'))) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` ADD COLUMN \`chargeSecondAbord\` tinyint(1) NOT NULL DEFAULT 0`,
      );
    }

    // Seed exclusivo Hermosillo. Solo si sigue en 0 para no pisar ediciones manuales.
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`chargeSecondAbord\` = 1
       WHERE \`name\` LIKE '%Hermosillo%' AND \`chargeSecondAbord\` = 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'subsidiary', 'chargeSecondAbord')) {
      await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`chargeSecondAbord\``);
    }
    // secondAbordAmount NO se revierte: preexistía a esta migración.
  }
}
