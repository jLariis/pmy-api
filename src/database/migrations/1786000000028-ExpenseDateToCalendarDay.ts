import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * expense.date pasa de DATETIME (mezcla de medianoche Central 06:00:00Z y de
 * instantes UTC reales) a DATE (día calendario Hermosillo, sin zona horaria).
 *
 * Backfill (distingue las dos formas históricas):
 *  - TIME(date) = '06:00:00'  => date-only Central: el día ya es DATE(date).
 *  - resto                    => instante real: día = Hermosillo (UTC-7).
 * Se usan offsets numéricos en CONVERT_TZ para no depender de las tz tables.
 */
export class ExpenseDateToCalendarDay1786000000028 implements MigrationInterface {
  name = 'ExpenseDateToCalendarDay1786000000028';

  public async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `expense` ADD COLUMN `date_day` DATE NULL');
    await q.query(`
      UPDATE \`expense\`
      SET \`date_day\` = CASE
        WHEN TIME(\`date\`) = '06:00:00' THEN DATE(\`date\`)
        ELSE DATE(CONVERT_TZ(\`date\`, '+00:00', '-07:00'))
      END
    `);
    await q.query('ALTER TABLE `expense` DROP COLUMN `date`');
    await q.query('ALTER TABLE `expense` CHANGE COLUMN `date_day` `date` DATE NOT NULL');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `expense` ADD COLUMN `date_dt` DATETIME NULL');
    // Día calendario Hermosillo -> instante UTC de su medianoche (00:00 -07:00 = 07:00Z).
    await q.query(`
      UPDATE \`expense\`
      SET \`date_dt\` = CONVERT_TZ(CONCAT(\`date\`, ' 00:00:00'), '-07:00', '+00:00')
    `);
    await q.query('ALTER TABLE `expense` DROP COLUMN `date`');
    await q.query('ALTER TABLE `expense` CHANGE COLUMN `date_dt` `date` DATETIME NOT NULL');
  }
}
