import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Bug de devoluciones con guías en varios consolidados:
 *  - `devolution.consolidatedId`: consolidado del envío devuelto (derivado en backend).
 *  - Índice compuesto (trackingNumber, consolidatedId) para la validación de duplicado.
 *
 * DEFENSIVA: guards a information_schema por si un `synchronize` ya agregó la columna/índice
 * (evita "duplicate column" / "duplicate key").
 */
export class AddConsolidatedIdToDevolution1786000000007 implements MigrationInterface {
  name = 'AddConsolidatedIdToDevolution1786000000007'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  private async indexExists(qr: QueryRunner, table: string, index: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, index],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'devolution', 'consolidatedId'))) {
      await queryRunner.query(
        `ALTER TABLE \`devolution\` ADD COLUMN \`consolidatedId\` varchar(255) NULL DEFAULT NULL`,
      );
    }
    if (!(await this.indexExists(queryRunner, 'devolution', 'IDX_devolution_tracking_cons'))) {
      await queryRunner.query(
        `CREATE INDEX \`IDX_devolution_tracking_cons\` ON \`devolution\` (\`trackingNumber\`, \`consolidatedId\`)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.indexExists(queryRunner, 'devolution', 'IDX_devolution_tracking_cons')) {
      await queryRunner.query(`DROP INDEX \`IDX_devolution_tracking_cons\` ON \`devolution\``);
    }
    if (await this.columnExists(queryRunner, 'devolution', 'consolidatedId')) {
      await queryRunner.query(`ALTER TABLE \`devolution\` DROP COLUMN \`consolidatedId\``);
    }
  }
}
