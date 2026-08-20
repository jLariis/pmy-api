import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Días festivos ADICIONALES definidos por el usuario (global). Complementan la lista
 * fija del Art. 74 LFT (en código) para el sobreprecio de cargas en domingo/festivo.
 *
 * No se siembra nada: los feriados oficiales siguen en código; esta tabla solo guarda
 * los EXTRA que capture el usuario (puentes, festivos locales, etc.).
 *
 * DEFENSIVA: guard a information_schema por el historial de `synchronize` del proyecto.
 */
export class AddHolidayTable1786000000054 implements MigrationInterface {
  name = 'AddHolidayTable1786000000054'

  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.tableExists(queryRunner, 'holiday'))) {
      await queryRunner.query(`
        CREATE TABLE \`holiday\` (
          \`id\` varchar(36) NOT NULL,
          \`name\` varchar(255) NOT NULL,
          \`date\` date NOT NULL,
          \`recurring\` tinyint NOT NULL DEFAULT 0,
          \`createdById\` char(36) NULL,
          \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`IDX_holiday_date\` (\`date\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'holiday')) {
      await queryRunner.query(`DROP TABLE \`holiday\``);
    }
  }
}
