import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabla `import_file`: guarda la metadata del archivo original de cada
 * importación FedEx (el binario vive en disco bajo uploads/imports/fedex/...).
 * DEFENSIVA: guard a information_schema por el historial de `synchronize`.
 */
export class AddImportFileTable1786000000055 implements MigrationInterface {
  name = 'AddImportFileTable1786000000055';

  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'import_file')) return;
    await queryRunner.query(`
      CREATE TABLE \`import_file\` (
        \`id\` varchar(36) NOT NULL,
        \`carrier\` varchar(255) NOT NULL DEFAULT 'FEDEX',
        \`kind\` varchar(255) NOT NULL,
        \`originalName\` varchar(255) NOT NULL,
        \`storagePath\` varchar(255) NOT NULL,
        \`mimeType\` varchar(255) NOT NULL DEFAULT 'application/octet-stream',
        \`size\` int NOT NULL DEFAULT 0,
        \`rowCount\` int NULL,
        \`subsidiaryId\` varchar(36) NULL,
        \`consNumber\` varchar(255) NULL,
        \`consolidatedId\` varchar(36) NULL,
        \`uploadedById\` varchar(36) NULL,
        \`uploadedByName\` varchar(255) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`IDX_import_file_subsidiary\` (\`subsidiaryId\`),
        KEY \`IDX_import_file_consolidated\` (\`consolidatedId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'import_file')) {
      await queryRunner.query(`DROP TABLE \`import_file\``);
    }
  }
}
