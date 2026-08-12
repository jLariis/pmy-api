import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrige el costo DHL de Obregón. La operación DHL real vive en la sucursal
 * "Bodega Obregon" (tiene envíos DHL), pero su `dhlCostPackage` estaba en 0, así que
 * sus entregas DHL generaban ingreso en $0. El costo (45) estaba puesto por error en
 * "Cuidad Obregon", que no tiene operación DHL.
 *
 *  1) Siembra `dhlCostPackage = 45` en "Bodega Obregon" SOLO si sigue en 0 (no pisa
 *     ediciones manuales posteriores).
 *  2) Recalcula los ingresos DHL históricos que quedaron en $0 y que SÍ debían cobrar
 *     (entregados, o no-entregados CON código DHL) al costo actual de la sucursal.
 *     Los no-entregados SIN código se dejan en 0 (regla de negocio: no facturables).
 *
 * Idempotente y guardada por nombre de sucursal: si en un entorno "Bodega Obregon" no
 * existe o ya tiene costo, no hace nada. Solo toca filas con cost=0.
 */
export class FixObregonDhlCost1786000000047 implements MigrationInterface {
  name = 'FixObregonDhlCost1786000000047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Seed del costo DHL en la sucursal con la operación real.
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`dhlCostPackage\` = 45
         WHERE \`name\` = 'Bodega Obregon' AND \`dhlCostPackage\` = 0`,
    );

    // 2) Recalcular los ingresos DHL en $0 que debían cobrar, al costo de la sucursal.
    await queryRunner.query(
      `UPDATE \`income\` i
         JOIN \`subsidiary\` s ON s.id = i.subsidiaryId
          SET i.\`cost\` = s.\`dhlCostPackage\`
        WHERE s.\`name\` = 'Bodega Obregon'
          AND i.\`shipmentType\` = 'dhl'
          AND i.\`cost\` = 0
          AND s.\`dhlCostPackage\` > 0
          AND (
            i.\`incomeType\` = 'entregado'
            OR (i.\`incomeType\` = 'no_entregado' AND i.\`nonDeliveryStatus\` IS NOT NULL AND i.\`nonDeliveryStatus\` <> '')
          )`,
    );
  }

  public async down(): Promise<void> {
    // no-op: no revertimos un cobro legítimo ni degradamos la configuración de costo.
  }
}
