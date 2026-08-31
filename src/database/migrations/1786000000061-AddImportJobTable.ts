import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tabla `import_job`: cola de importaciones por *paste* (envíos y cargas). */
export class AddImportJobTable1786000000061 implements MigrationInterface {
  name = 'AddImportJobTable1786000000061';

  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'import_job')) return;
    await queryRunner.query(`
      CREATE TABLE \`import_job\` (
        \`id\` varchar(36) NOT NULL,
        \`kind\` varchar(16) NOT NULL,
        \`status\` varchar(16) NOT NULL DEFAULT 'pending',
        \`source\` varchar(16) NOT NULL DEFAULT 'paste',
        \`subsidiaryId\` varchar(36) NOT NULL,
        \`consNumber\` varchar(255) NOT NULL,
        \`consDate\` datetime NULL,
        \`isAereo\` tinyint NOT NULL DEFAULT 0,
        \`isHalfTon\` tinyint NOT NULL DEFAULT 0,
        \`notRemoveCharge\` tinyint NOT NULL DEFAULT 0,
        \`label\` varchar(255) NULL,
        \`payloadHash\` varchar(64) NOT NULL,
        \`payloadRows\` longtext NOT NULL,
        \`onlyTrackings\` longtext NULL,
        \`parentJobId\` varchar(36) NULL,
        \`claimToken\` varchar(36) NULL,
        \`totalRows\` int NOT NULL DEFAULT 0,
        \`processedRows\` int NOT NULL DEFAULT 0,
        \`saved\` int NOT NULL DEFAULT 0,
        \`duplicated\` int NOT NULL DEFAULT 0,
        \`recycled\` int NOT NULL DEFAULT 0,
        \`failed\` int NOT NULL DEFAULT 0,
        \`hvMarked\` int NOT NULL DEFAULT 0,
        \`cobrosApplied\` int NOT NULL DEFAULT 0,
        \`cobrosUnmatched\` int NOT NULL DEFAULT 0,
        \`result\` longtext NULL,
        \`consolidatedId\` varchar(36) NULL,
        \`error\` text NULL,
        \`attempts\` int NOT NULL DEFAULT 0,
        \`claimedAt\` datetime NULL,
        \`startedAt\` datetime NULL,
        \`heartbeatAt\` datetime NULL,
        \`finishedAt\` datetime NULL,
        \`createdById\` varchar(36) NULL,
        \`createdByName\` varchar(255) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_import_job_status_created\` (\`status\`, \`createdAt\`),
        KEY \`IDX_import_job_idem\` (\`subsidiaryId\`, \`kind\`, \`consNumber\`, \`payloadHash\`, \`createdAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'import_job')) {
      await queryRunner.query(`DROP TABLE \`import_job\``);
    }
  }
}
