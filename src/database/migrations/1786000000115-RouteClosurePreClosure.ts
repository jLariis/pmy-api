import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Cierre de ruta con pre-cierre y comprobación guía por guía (decisión del usuario 2026-10-21,
 * piloto Cabo San Lucas; spec docs/superpowers/specs/2026-10-21-cierre-ruta-precierre-cabo-design.md):
 *  - `subsidiary.routeClosureWithPreClosure`: la sucursal cierra en la pantalla completa con
 *    pre-cierre obligatorio. Configuración normal de sucursal (se prende/apaga desde Configuración).
 *    Seed: solo Cabo San Lucas.
 *  - `shipment_status.source`: origen del renglón de historial; 'route_closure_manual' cuando el
 *    estatus se capturó a mano en el cierre. Los demás orígenes quedan NULL.
 *  - `route_closure.preClosureGeneratedAt`: cuándo se generó el PDF de pre-cierre (auditoría).
 *  - Tabla `route_closure_manual_status`: auditoría de cada cambio manual del cierre
 *    (mismo espíritu que `shipment_not_in_files` para No VAN).
 *
 * DEFENSIVA: guard a information_schema (evita "duplicate column" si DB_SYNC ya la agregó).
 */
export class RouteClosurePreClosure1786000000115 implements MigrationInterface {
  name = 'RouteClosurePreClosure1786000000115'

  private static readonly CABO_SAN_LUCAS_ID = 'abf2fc38-cb42-41b6-9554-4b71c11b8916';

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  private readonly columns: [string, string, string][] = [
    ['subsidiary', 'routeClosureWithPreClosure', 'tinyint(1) NOT NULL DEFAULT 0'],
    ['shipment_status', 'source', 'varchar(32) NULL'],
    ['route_closure', 'preClosureGeneratedAt', 'datetime NULL'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, col, def] of this.columns) {
      if (!(await this.columnExists(queryRunner, table, col))) {
        await queryRunner.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
      }
    }

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`route_closure_manual_status\` (
        \`id\` varchar(36) NOT NULL,
        \`routeClosureId\` varchar(36) NOT NULL,
        \`shipmentId\` varchar(36) NULL,
        \`chargeShipmentId\` varchar(36) NULL,
        \`trackingNumber\` varchar(255) NOT NULL,
        \`previousStatus\` varchar(64) NOT NULL,
        \`newStatus\` varchar(64) NOT NULL,
        \`exceptionCode\` varchar(16) NULL,
        \`reason\` text NOT NULL,
        \`appliedToLive\` tinyint(1) NOT NULL DEFAULT 1,
        \`createdById\` varchar(36) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_rcms_routeClosureId\` (\`routeClosureId\`),
        INDEX \`idx_rcms_trackingNumber\` (\`trackingNumber\`)
      ) ENGINE=InnoDB`,
    );
    // Columna agregada después de crear la tabla en algunos entornos de desarrollo.
    if (!(await this.columnExists(queryRunner, 'route_closure_manual_status', 'appliedToLive'))) {
      await queryRunner.query(
        `ALTER TABLE \`route_closure_manual_status\` ADD COLUMN \`appliedToLive\` tinyint(1) NOT NULL DEFAULT 1 AFTER \`reason\``,
      );
    }

    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`routeClosureWithPreClosure\` = 1 WHERE \`id\` = ?`,
      [RouteClosurePreClosure1786000000115.CABO_SAN_LUCAS_ID],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`route_closure_manual_status\``);
    for (const [table, col] of [...this.columns].reverse()) {
      if (await this.columnExists(queryRunner, table, col)) {
        await queryRunner.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${col}\``);
      }
    }
  }
}
