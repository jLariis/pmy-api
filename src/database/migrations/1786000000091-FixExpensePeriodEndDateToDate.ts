import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repara periodos de gasto capturados "fecha a fecha": el "hasta" quedó como el MISMO día de la
 * semana/mes/año siguiente (vie 14 → vie 21, 27 jul → 27 ago, 1 sep → 1 oct). El prorrateo cuenta
 * ambos extremos, así que esas semanas se repartían en 8 días y los meses en 31/32.
 * Misma regla que `normalizePeriodEnd` (expense-proration.util): si periodEnd es exactamente el
 * inicio del siguiente periodo, se recorta un día. DATE_ADD de MySQL ajusta fin de mes igual que
 * la util (31 ene + 1 mes = 28 feb).
 * Guarda el valor anterior en `expense_period_fix_091` para poder revertir.
 */
export class FixExpensePeriodEndDateToDate1786000000091 implements MigrationInterface {
  name = 'FixExpensePeriodEndDateToDate1786000000091';

  public async up(q: QueryRunner): Promise<void> {
    const match = `e.periodStart IS NOT NULL AND e.periodEnd IS NOT NULL AND (
      (e.frequency = 'Semanal' AND e.periodEnd = DATE_ADD(e.periodStart, INTERVAL 7 DAY)) OR
      (e.frequency = 'Mensual' AND e.periodEnd = DATE_ADD(e.periodStart, INTERVAL 1 MONTH)) OR
      (e.frequency = 'Anual'   AND e.periodEnd = DATE_ADD(e.periodStart, INTERVAL 1 YEAR)))`;

    await q.query(
      'CREATE TABLE IF NOT EXISTS `expense_period_fix_091` (`id` varchar(36) NOT NULL PRIMARY KEY, `oldPeriodEnd` DATE NOT NULL)',
    );
    await q.query(`INSERT IGNORE INTO expense_period_fix_091 (id, oldPeriodEnd) SELECT e.id, e.periodEnd FROM expense e WHERE ${match}`);
    await q.query(
      'UPDATE expense e JOIN expense_period_fix_091 f ON f.id = e.id AND f.oldPeriodEnd = e.periodEnd ' +
        'SET e.periodEnd = DATE_SUB(e.periodEnd, INTERVAL 1 DAY)',
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('UPDATE expense e JOIN expense_period_fix_091 f ON f.id = e.id SET e.periodEnd = f.oldPeriodEnd');
    await q.query('DROP TABLE IF EXISTS `expense_period_fix_091`');
  }
}
