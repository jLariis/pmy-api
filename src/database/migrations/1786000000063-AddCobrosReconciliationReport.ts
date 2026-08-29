import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tabla `cobros_reconciliation_report`: snapshots diarios de la reconciliación de cobros. */
export class AddCobrosReconciliationReport1786000000063 implements MigrationInterface {
  name = 'AddCobrosReconciliationReport1786000000063';

  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'cobros_reconciliation_report')) return;
    await queryRunner.query(`
      CREATE TABLE \`cobros_reconciliation_report\` (
        \`id\` varchar(36) NOT NULL,
        \`runAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`windowDays\` int NOT NULL DEFAULT 14,
        \`deliveredShipments\` int NOT NULL DEFAULT 0,
        \`missingCount\` int NOT NULL DEFAULT 0,
        \`orphanCount\` int NOT NULL DEFAULT 0,
        \`missingSample\` longtext NULL,
        \`orphanSample\` longtext NULL,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_cobros_recon_runAt\` (\`runAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'cobros_reconciliation_report')) {
      await queryRunner.query(`DROP TABLE \`cobros_reconciliation_report\``);
    }
  }
}
