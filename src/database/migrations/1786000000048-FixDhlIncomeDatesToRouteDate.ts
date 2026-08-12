import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrige la FECHA de los ingresos DHL para que reflejen el DÍA DE LA RUTA (salida a ruta
 * = `package_dispatch.createdAt`), no el día en que se hizo el cierre de ruta.
 *
 * Antes, `routeclosure.service` fechaba el ingreso con `new Date()` (momento del cierre),
 * así que al cerrar rutas atrasadas todos los ingresos se apilaban en el día del cierre.
 * El código ya se corrigió (usa `hermosilloDayStartFromInstant(dispatch.createdAt)`); esta
 * migración reubica los ingresos históricos al día correcto.
 *
 * Nueva fecha = medianoche de Hermosillo (07:00Z) del día (en zona Hermosillo, UTC-7) de
 * la salida a ruta. Solo toca ingresos DHL de envío (sourceType='shipment') trazables a un
 * despacho. Idempotente: recomputa el mismo valor si se corre otra vez.
 */
export class FixDhlIncomeDatesToRouteDate1786000000048 implements MigrationInterface {
  name = 'FixDhlIncomeDatesToRouteDate1786000000048';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`income\` i
         JOIN \`shipment\` sh ON sh.id = i.\`shipmentId\`
         JOIN \`package_dispatch\` pd ON pd.id = sh.\`routeId\`
          SET i.\`date\` = CONVERT_TZ(DATE(CONVERT_TZ(pd.\`createdAt\`, '+00:00', '-07:00')), '-07:00', '+00:00')
        WHERE i.\`shipmentType\` = 'dhl'
          AND i.\`sourceType\` = 'shipment'
          AND sh.\`routeId\` IS NOT NULL`,
    );
  }

  public async down(): Promise<void> {
    // no-op: la fecha original (día de cierre) era incorrecta y no se reconstruye.
  }
}
