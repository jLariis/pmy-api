import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Corrige los `trackingNumber` de `returning_history` que quedaron mal.
 *
 * El reconciliador 043 rellenó `trackingNumber` desde el viejo `folio` (dando "1", "2", …) o
 * derivado del uuid. Aquí regeneramos un código de 12 dígitos (mismo formato que genera la
 * entidad en @BeforeInsert) para toda fila cuyo `trackingNumber` NO sea 12 dígitos. Idempotente:
 * las filas que ya tienen un código válido no se tocan. `RAND()` se evalúa por fila en MySQL.
 */
export class FixReturningTrackingNumbers1786000000044 implements MigrationInterface {
  name = 'FixReturningTrackingNumbers1786000000044'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'returning_history', 'trackingNumber'))) return;

    await queryRunner.query(`
      UPDATE \`returning_history\`
      SET \`trackingNumber\` = LPAD(FLOOR(RAND() * 1000000000000), 12, '0')
      WHERE \`trackingNumber\` IS NULL
         OR \`trackingNumber\` NOT REGEXP '^[0-9]{12}$'
    `);
  }

  public async down(): Promise<void> {
    // Corrección de datos; no se revierte.
  }
}
