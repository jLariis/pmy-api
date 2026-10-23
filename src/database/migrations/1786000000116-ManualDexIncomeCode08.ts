import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Correcciones del Consolidador visibles en todos los reportes (2026-10-23):
 * el alta manual "DEX / 3ª visita" se guardaba como `cliente_no_disponible_3ra_visita` SIN código
 * de no entrega. Sin código no encontraba regla en `charge_rule` y, en FedEx, desde el
 * 19-oct-2026 dejaba de sumar en Finanzas → Ingresos y el Dashboard (y no entraba al conteo de
 * DEX08). Ahora el alta lo guarda igual que el automático (`no_entregado` + '08'); esta migración
 * repara los ya guardados.
 *
 * Solo toca filas con ese incomeType (únicamente lo escribía el alta manual). El down revierte
 * solo las que nacieron de un alta manual DEX (income_change_log manual_create / field 'dex').
 */
export class ManualDexIncomeCode081786000000116 implements MigrationInterface {
  name = 'ManualDexIncomeCode081786000000116'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`income\`
          SET \`incomeType\` = 'no_entregado', \`nonDeliveryStatus\` = '08'
        WHERE \`incomeType\` = 'cliente_no_disponible_3ra_visita'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`income\` i
          JOIN \`income_change_log\` l ON l.\`incomeId\` = i.\`id\` AND l.\`action\` = 'manual_create' AND l.\`field\` = 'dex'
          SET i.\`incomeType\` = 'cliente_no_disponible_3ra_visita', i.\`nonDeliveryStatus\` = ''
        WHERE i.\`incomeType\` = 'no_entregado' AND i.\`nonDeliveryStatus\` = '08'`,
    );
  }
}
