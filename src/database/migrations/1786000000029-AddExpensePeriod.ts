import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Periodo de cobertura del gasto para prorratear (día calendario Hermosillo).
 * Nullable: los gastos sin periodo se tratan como puntuales en su `date`.
 * No requiere backfill — los existentes se quedan como puntuales.
 */
export class AddExpensePeriod1786000000029 implements MigrationInterface {
  name = 'AddExpensePeriod1786000000029';

  public async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `expense` ADD COLUMN `periodStart` DATE NULL');
    await q.query('ALTER TABLE `expense` ADD COLUMN `periodEnd` DATE NULL');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `expense` DROP COLUMN `periodEnd`');
    await q.query('ALTER TABLE `expense` DROP COLUMN `periodStart`');
  }
}
