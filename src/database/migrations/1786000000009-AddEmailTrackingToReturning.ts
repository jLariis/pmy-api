import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Estado denormalizado del correo en las "Salidas" (returning_history): pinta el botón/tooltip
 * de estatus y permite reenviar. Espejo de lo que ya hace package_dispatch.
 * DEFENSIVA (guards a information_schema) por el historial de synchronize del proyecto.
 */
export class AddEmailTrackingToReturning1786000000009 implements MigrationInterface {
  name = 'AddEmailTrackingToReturning1786000000009'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  private async addColumnIfMissing(qr: QueryRunner, table: string, column: string, ddl: string) {
    if (!(await this.columnExists(qr, table, column))) {
      await qr.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addColumnIfMissing(
      queryRunner, 'returning_history', 'emailStatus',
      "`emailStatus` enum('not_sent','sent','error') NOT NULL DEFAULT 'not_sent'",
    );
    await this.addColumnIfMissing(
      queryRunner, 'returning_history', 'emailLastSentAt', '`emailLastSentAt` timestamp NULL',
    );
    await this.addColumnIfMissing(
      queryRunner, 'returning_history', 'emailLastError', '`emailLastError` varchar(500) NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const col of ['emailLastError', 'emailLastSentAt', 'emailStatus']) {
      if (await this.columnExists(queryRunner, 'returning_history', col)) {
        await queryRunner.query(`ALTER TABLE \`returning_history\` DROP COLUMN \`${col}\``);
      }
    }
  }
}
