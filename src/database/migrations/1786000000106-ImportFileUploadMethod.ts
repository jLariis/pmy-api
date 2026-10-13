import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Importaciones: desde DÓNDE se subió cada archivo (2026-10-13, pedido del usuario).
 *  - `uploadMethod`: clave de la pantalla (asistente | pegar_fedex | bandeja_correo | subida_rapida);
 *    los nombres en llano viven en src/import-files/upload-method.util.ts. NULL = archivos previos.
 *  - `uploadDetail`: detalle legible (p. ej. el modo de la F2).
 *
 * DEFENSIVA: guard a information_schema (evita "duplicate column" si DB_SYNC ya la agregó).
 */
export class ImportFileUploadMethod1786000000106 implements MigrationInterface {
  name = 'ImportFileUploadMethod1786000000106'

  private async columnExists(qr: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.columnExists(queryRunner, 'import_file', 'uploadMethod'))) {
      await queryRunner.query(`ALTER TABLE \`import_file\` ADD COLUMN \`uploadMethod\` varchar(40) NULL`);
    }
    if (!(await this.columnExists(queryRunner, 'import_file', 'uploadDetail'))) {
      await queryRunner.query(`ALTER TABLE \`import_file\` ADD COLUMN \`uploadDetail\` varchar(120) NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.columnExists(queryRunner, 'import_file', 'uploadDetail')) {
      await queryRunner.query(`ALTER TABLE \`import_file\` DROP COLUMN \`uploadDetail\``);
    }
    if (await this.columnExists(queryRunner, 'import_file', 'uploadMethod')) {
      await queryRunner.query(`ALTER TABLE \`import_file\` DROP COLUMN \`uploadMethod\``);
    }
  }
}
