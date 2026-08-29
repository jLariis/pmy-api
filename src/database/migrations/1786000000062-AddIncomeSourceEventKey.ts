import { MigrationInterface, QueryRunner } from 'typeorm';

/** Ancla de cobro al evento terminal FedEx: income.sourceEventKey. */
export class AddIncomeSourceEventKey1786000000062 implements MigrationInterface {
  name = 'AddIncomeSourceEventKey1786000000062';

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'income', 'sourceEventKey'))) {
      await queryRunner.query(`ALTER TABLE \`income\` ADD COLUMN \`sourceEventKey\` varchar(120) NULL`);
    }
    // Índice de idempotencia/reconciliación (no único: ingresos legacy tienen NULL).
    const idx = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'income' AND INDEX_NAME = 'IDX_income_source_event'`,
    );
    if (Number(idx[0].c) === 0) {
      await queryRunner.query(
        `CREATE INDEX \`IDX_income_source_event\` ON \`income\` (\`trackingNumber\`, \`incomeType\`, \`sourceEventKey\`)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const idx = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'income' AND INDEX_NAME = 'IDX_income_source_event'`,
    );
    if (Number(idx[0].c) > 0) await queryRunner.query(`DROP INDEX \`IDX_income_source_event\` ON \`income\``);
    if (await this.columnExists(queryRunner, 'income', 'sourceEventKey')) {
      await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`sourceEventKey\``);
    }
  }
}
