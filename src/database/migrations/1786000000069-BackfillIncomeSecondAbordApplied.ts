import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill CONSERVADOR de `income.secondAbordApplied` para cargas históricas (creadas antes de la
 * mig 067, con el flag en NULL). Se INFIERE del costo ya cobrado comparándolo con el precio ACTUAL
 * de la sucursal (±0.01):
 *   - =1 : cost ≈ chargeCost + secondAbordAmount  (y la sucursal cobra 2º a bordo).
 *   - =0 : cost ≈ chargeCost normal, o ≈ chargeCostHalfTon / los sobreprecios domingo-festivo
 *          (el 2º a bordo NUNCA aplica sobre 1.5 ton ni sobre el sobreprecio).
 *   - NULL: si no empata con ningún precio conocido (p.ej. el precio cambió desde entonces) → se
 *          deja sin tocar para NO adivinar.
 * Solo actualiza el flag; no cambia montos ni esquema. Data migration → down() es no-op (no se
 * puede distinguir lo backfilleado de lo que ya venía marcado por la app).
 */
export class BackfillIncomeSecondAbordApplied1786000000069 implements MigrationInterface {
  name = 'BackfillIncomeSecondAbordApplied1786000000069';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) CON 2º a bordo: cost ≈ chargeCost + secondAbordAmount.
    await queryRunner.query(`
      UPDATE \`income\` i
      JOIN \`subsidiary\` s ON s.id = i.subsidiaryId
      SET i.secondAbordApplied = 1
      WHERE i.sourceType = 'charge'
        AND i.secondAbordApplied IS NULL
        AND s.chargeSecondAbord = 1
        AND s.secondAbordAmount > 0
        AND ABS(i.cost - (s.chargeCost + s.secondAbordAmount)) < 0.01
    `);

    // 2) SIN 2º a bordo: cost ≈ base normal, 1.5 ton, o sobreprecios domingo/festivo.
    await queryRunner.query(`
      UPDATE \`income\` i
      JOIN \`subsidiary\` s ON s.id = i.subsidiaryId
      SET i.secondAbordApplied = 0
      WHERE i.sourceType = 'charge'
        AND i.secondAbordApplied IS NULL
        AND (
              ABS(i.cost - s.chargeCost) < 0.01
          OR (s.chargeCostHalfTon > 0 AND ABS(i.cost - s.chargeCostHalfTon) < 0.01)
          OR (s.chargeCostSundayHoliday > 0 AND ABS(i.cost - s.chargeCostSundayHoliday) < 0.01)
          OR (s.chargeCostHalfTonSundayHoliday > 0 AND ABS(i.cost - s.chargeCostHalfTonSundayHoliday) < 0.01)
        )
    `);
  }

  public async down(): Promise<void> {
    // Data migration: no se revierte (no se distingue lo backfilleado de lo marcado por la app).
  }
}
