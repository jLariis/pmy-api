import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Borrado con aprobación (baja lógica):
 *  - Columna `active` (tinyint, default 1) en consolidated / package_dispatch /
 *    shipment / charge_shipment. Se rellenan los existentes en 1.
 *  - Columna `subsidiary.supervisorUserId` (encargado que autoriza borrados).
 *  - Tabla `approval_request` (solicitudes de autorización).
 *
 * DEFENSIVA: guards a information_schema por el historial de `synchronize`.
 */
export class AddActiveAndSupervisorAndApprovals1786000000056 implements MigrationInterface {
  name = 'AddActiveAndSupervisorAndApprovals1786000000056';

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

  private async addActive(qr: QueryRunner, table: string): Promise<void> {
    if (!(await this.columnExists(qr, table, 'active'))) {
      await qr.query(`ALTER TABLE \`${table}\` ADD COLUMN \`active\` tinyint NOT NULL DEFAULT 1`);
      await qr.query(`UPDATE \`${table}\` SET \`active\` = 1 WHERE \`active\` IS NULL`);
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addActive(queryRunner, 'consolidated');
    await this.addActive(queryRunner, 'package_dispatch');
    await this.addActive(queryRunner, 'shipment');
    await this.addActive(queryRunner, 'charge_shipment');

    if (!(await this.columnExists(queryRunner, 'subsidiary', 'supervisorUserId'))) {
      await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD COLUMN \`supervisorUserId\` varchar(36) NULL`);
    }

    if (!(await this.tableExists(queryRunner, 'approval_request'))) {
      await queryRunner.query(`
        CREATE TABLE \`approval_request\` (
          \`id\` varchar(36) NOT NULL,
          \`type\` varchar(255) NOT NULL,
          \`targetId\` varchar(36) NOT NULL,
          \`subsidiaryId\` varchar(36) NULL,
          \`requestedById\` varchar(36) NULL,
          \`requestedByName\` varchar(255) NULL,
          \`approverId\` varchar(36) NULL,
          \`approverName\` varchar(255) NULL,
          \`status\` varchar(255) NOT NULL DEFAULT 'pendiente',
          \`reason\` text NULL,
          \`impactSnapshot\` json NULL,
          \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`resolvedAt\` datetime NULL,
          PRIMARY KEY (\`id\`),
          KEY \`IDX_approval_target\` (\`targetId\`),
          KEY \`IDX_approval_approver\` (\`approverId\`),
          KEY \`IDX_approval_status\` (\`status\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'approval_request')) {
      await queryRunner.query(`DROP TABLE \`approval_request\``);
    }
    if (await this.columnExists(queryRunner, 'subsidiary', 'supervisorUserId')) {
      await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`supervisorUserId\``);
    }
    for (const t of ['charge_shipment', 'shipment', 'package_dispatch', 'consolidated']) {
      if (await this.columnExists(queryRunner, t, 'active')) {
        await queryRunner.query(`ALTER TABLE \`${t}\` DROP COLUMN \`active\``);
      }
    }
  }
}
