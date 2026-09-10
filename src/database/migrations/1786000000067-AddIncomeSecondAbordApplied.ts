import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidador de Finanzas: estado por-fila del 2º a bordo en `income`.
 *  - secondAbordApplied: true = el `cost` YA incluye el `secondAbordAmount` de la sucursal.
 *    Null = nunca tocado (se infiere de `subsidiary.chargeSecondAbord` la primera vez).
 * Hace idempotente el toggle "quitar/poner 2º a bordo" del consolidador.
 */
export class AddIncomeSecondAbordApplied1786000000067 implements MigrationInterface {
  name = 'AddIncomeSecondAbordApplied1786000000067';

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'income', 'secondAbordApplied'))) {
      await queryRunner.query(`ALTER TABLE \`income\` ADD COLUMN \`secondAbordApplied\` tinyint(1) NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'income', 'secondAbordApplied')) {
      await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`secondAbordApplied\``);
    }
  }
}
