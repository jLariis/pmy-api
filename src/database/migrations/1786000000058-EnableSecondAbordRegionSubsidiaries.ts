import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Segundo abordo (chargeSecondAbord) para las sucursales que a partir de ahora cobran
 * IGUAL que Hermosillo: ingreso de carga = costo NORMAL de la carga (`chargeCost`) + segundo
 * abordo (`secondAbordAmount`). Los precios de domingo/festivo NO cambian con esta migración.
 *
 * Sucursales nuevas: La Paz, Guaymas, Bodega Obregon, Cuidad Obregon (typo real en BD) y Via Larga.
 *
 * Estado previo (dev):
 *  - Guaymas / Bodega Obregon / Cuidad Obregon / Via Larga: ya tienen secondAbordAmount = 594 y
 *    chargeCostHalfTon = 0 → basta prender el flag para que sumen 594 sobre su base normal.
 *  - La Paz: secondAbordAmount = 0 → además del flag hay que capturar el monto (594, como Hermosillo).
 *
 * Reglas defensivas (igual que la migración 057):
 *  - Solo prende el flag donde sigue en 0 (no pisa toggles manuales de Configuración).
 *  - Solo captura el monto de La Paz si sigue en 0 (no pisa un monto ya capturado en producción).
 *  - Match por nombre EXACTO (IN) para no tocar otras sucursales.
 *
 * Nota sobre el "4635.62" histórico: era el `chargeCost` viejo de Guaymas; esta migración NO
 * reescribe ingresos ya generados, solo cambia el comportamiento de las cargas futuras.
 */
export class EnableSecondAbordRegionSubsidiaries1786000000058 implements MigrationInterface {
  name = 'EnableSecondAbordRegionSubsidiaries1786000000058'

  // Nombres EXACTOS tal cual están en la tabla `subsidiary` (incluye el typo "Cuidad").
  private readonly names = ['La Paz', 'Guaymas', 'Bodega Obregon', 'Cuidad Obregon', 'Via Larga'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const placeholders = this.names.map(() => '?').join(', ');

    // 1. La Paz (u otra de la lista sin monto) → capturar el segundo abordo (594) SOLO si sigue en 0.
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`secondAbordAmount\` = 594.00
       WHERE \`name\` IN (${placeholders}) AND \`secondAbordAmount\` = 0`,
      this.names,
    );

    // 2. Prender el flag SOLO donde sigue apagado (no pisa ediciones manuales).
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`chargeSecondAbord\` = 1
       WHERE \`name\` IN (${placeholders}) AND \`chargeSecondAbord\` = 0`,
      this.names,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const placeholders = this.names.map(() => '?').join(', ');
    // Revierte SOLO el flag (el monto puede haber sido capturado/editado aparte).
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`chargeSecondAbord\` = 0
       WHERE \`name\` IN (${placeholders})`,
      this.names,
    );
  }
}
