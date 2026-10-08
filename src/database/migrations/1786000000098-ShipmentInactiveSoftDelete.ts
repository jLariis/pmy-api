import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Guías dadas de baja (`active = 0`: consolidado borrado con autorización, cambio de tipo
 * paquete↔carga) seguían saliendo en salidas, cierres, inventarios, desembarques… porque cada
 * consulta tenía que acordarse de filtrar `active` (caso salida 068422797359: 30 cargas pasadas
 * a paquete se veían 60).
 *
 * Solución de raíz: columna VIRTUAL `inactiveAt` calculada de `active` en shipment y
 * charge_shipment, mapeada como @DeleteDateColumn. TypeORM excluye solo las filas con
 * `inactiveAt` en find/QueryBuilder/joins/relaciones. Al ser calculada nunca se desincroniza de
 * `active` (la baja y el regreso siguen siendo `active = 0/1`); TypeORM no la escribe.
 * VIRTUAL = alta instantánea, sin reconstruir la tabla.
 */
export class ShipmentInactiveSoftDelete1786000000098 implements MigrationInterface {
  name = 'ShipmentInactiveSoftDelete1786000000098'

  private readonly tables = ['shipment', 'charge_shipment'];

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      if (!(await this.columnExists(queryRunner, table, 'inactiveAt'))) {
        await queryRunner.query(
          `ALTER TABLE \`${table}\` ADD COLUMN \`inactiveAt\` datetime
             GENERATED ALWAYS AS (IF(\`active\` = 0, '2000-01-01 00:00:00', NULL)) VIRTUAL`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      if (await this.columnExists(queryRunner, table, 'inactiveAt')) {
        await queryRunner.query(`ALTER TABLE \`${table}\` DROP COLUMN \`inactiveAt\``);
      }
    }
  }
}
