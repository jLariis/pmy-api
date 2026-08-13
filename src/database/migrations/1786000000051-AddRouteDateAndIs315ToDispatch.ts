import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Salida a ruta: dos props nuevas fijadas al crear el despacho.
 *  - `routeDate` (DATE): día operativo de la ruta. Ancla de los ingresos del cierre
 *    (DHL, recolecciones y No VAN). Default en app = hoy; fallback a `createdAt` si null.
 *  - `is315` (bool): marca de ruta 31.5. true ⇒ los No VAN NO generan ingreso.
 *
 * DEFENSIVA: guard a information_schema por el historial de `synchronize` del proyecto.
 */
export class AddRouteDateAndIs315ToDispatch1786000000051 implements MigrationInterface {
  name = 'AddRouteDateAndIs315ToDispatch1786000000051'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'package_dispatch', 'routeDate'))) {
      await queryRunner.query(
        `ALTER TABLE \`package_dispatch\` ADD COLUMN \`routeDate\` date NULL`,
      );
    }
    if (!(await this.columnExists(queryRunner, 'package_dispatch', 'is315'))) {
      await queryRunner.query(
        `ALTER TABLE \`package_dispatch\` ADD COLUMN \`is315\` tinyint(1) NOT NULL DEFAULT 0`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'package_dispatch', 'is315')) {
      await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP COLUMN \`is315\``);
    }
    if (await this.columnExists(queryRunner, 'package_dispatch', 'routeDate')) {
      await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP COLUMN \`routeDate\``);
    }
  }
}
