import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Regla "solo la primera carga del día" por sucursal.
 *
 *  - `subsidiary.chargeOnlyFirstOfDay` (tinyint, default 0): si está activo, para los consolidados
 *    de tipo CARGA solo la PRIMERA carga del día operativo genera cobro; las cargas 2ª+ del mismo
 *    día se registran igual (carga y paquetes) pero con `income.cost = 0`.
 *  - `income.chargeNotChargedSameDay` (tinyint, default 0): trazabilidad por-fila del $0 anterior
 *    (distingue un $0 por-regla de un $0 por configuración).
 *
 * Siembra: SOLO La Paz queda en true (todas las demás en false = comportamiento histórico).
 * Reglas defensivas (igual que 057/058): prende el flag SOLO donde sigue apagado (no pisa toggles
 * manuales de Configuración) y hace match por nombre EXACTO.
 */
export class AddChargeOnlyFirstOfDay1786000000072 implements MigrationInterface {
  name = 'AddChargeOnlyFirstOfDay1786000000072';

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'subsidiary', 'chargeOnlyFirstOfDay'))) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` ADD COLUMN \`chargeOnlyFirstOfDay\` tinyint(1) NOT NULL DEFAULT 0`,
      );
    }
    if (!(await this.columnExists(queryRunner, 'income', 'chargeNotChargedSameDay'))) {
      await queryRunner.query(
        `ALTER TABLE \`income\` ADD COLUMN \`chargeNotChargedSameDay\` tinyint(1) NOT NULL DEFAULT 0`,
      );
    }

    // Siembra: prende el flag SOLO para La Paz y SOLO si sigue apagado.
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`chargeOnlyFirstOfDay\` = 1
       WHERE \`name\` = 'La Paz' AND \`chargeOnlyFirstOfDay\` = 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'income', 'chargeNotChargedSameDay')) {
      await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`chargeNotChargedSameDay\``);
    }
    if (await this.columnExists(queryRunner, 'subsidiary', 'chargeOnlyFirstOfDay')) {
      await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`chargeOnlyFirstOfDay\``);
    }
  }
}
