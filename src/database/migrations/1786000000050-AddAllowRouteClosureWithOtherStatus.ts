import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Cierre de ruta con "otros estatus":
 *  - `subsidiary.allowRouteClosureWithOtherStatus`: si está activo, la ruta se puede
 *    CERRAR aunque queden paquetes en "Otros Estatus" (sin resolver) venciendo hoy.
 *    Default false = comportamiento histórico (bloquea).
 *  - Seed: activo SOLO para la sucursal Hermosillo. Se excluye explícitamente
 *    "Bodega Hermosillo" (isWarehouse = 1), por eso el filtro por nombre exacto +
 *    guard de bodega.
 *
 * DEFENSIVA: guard a information_schema por el historial de `synchronize` del proyecto
 * (evita "duplicate column" si un DB_SYNC ya agregó la columna en dev).
 */
export class AddAllowRouteClosureWithOtherStatus1786000000050 implements MigrationInterface {
  name = 'AddAllowRouteClosureWithOtherStatus1786000000050'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'subsidiary', 'allowRouteClosureWithOtherStatus'))) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` ADD COLUMN \`allowRouteClosureWithOtherStatus\` tinyint(1) NOT NULL DEFAULT 0`,
      );
    }

    // Seed exclusivo Hermosillo (sucursal, NO Bodega Hermosillo). Nombre exacto +
    // guard isWarehouse = 0 para no activarlo en la bodega.
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`allowRouteClosureWithOtherStatus\` = 1
       WHERE \`name\` = 'Hermosillo' AND \`isWarehouse\` = 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'subsidiary', 'allowRouteClosureWithOtherStatus')) {
      await queryRunner.query(
        `ALTER TABLE \`subsidiary\` DROP COLUMN \`allowRouteClosureWithOtherStatus\``,
      );
    }
  }
}
