import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Las sucursales satélite de la estación FedEx de Cd. Obregón revisan el código 44 (en estación)
 * en lugar del 67: Álamos, Huatabampo, Navojoa, Pueblo Yaqui, Vícam y Villa Juárez.
 *
 * Caso 2026-10-09: 519750418785 (Huatabampo) y 383851714183 (Villa Juárez) salían "sin código 44"
 * ayer aunque FedEx sí lo dio (08-oct 21:36). Estaban en 67 (`monitorFedexCode44 = 0`), así que el
 * 44 no se guardaba y el reporte buscaba el 67. Decisión de negocio: estas sucursales son de 44.
 * Convención de una sucursal de 44: `44 on / 67 off` (como Hermosillo).
 *
 * Se targetea por nombre exacto (sin duplicados). El `down` regresa el estado previo: todas en
 * 67 on, salvo Álamos, que estaba con ambos apagados.
 */
export class MonitorCode44ObregonSatellites1786000000102 implements MigrationInterface {
  name = 'MonitorCode44ObregonSatellites1786000000102'

  private static readonly NAMES = ['Alamos', 'Huatabampo', 'Navojoa', 'Pueblo Yaqui', 'Vicam', 'Villa Juarez'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`monitorFedexCode44\` = 1, \`monitorFedexCode67\` = 0
       WHERE \`name\` IN (?, ?, ?, ?, ?, ?)`,
      MonitorCode44ObregonSatellites1786000000102.NAMES,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`monitorFedexCode44\` = 0,
              \`monitorFedexCode67\` = CASE WHEN \`name\` = 'Alamos' THEN 0 ELSE 1 END
       WHERE \`name\` IN (?, ?, ?, ?, ?, ?)`,
      MonitorCode44ObregonSatellites1786000000102.NAMES,
    );
  }
}
