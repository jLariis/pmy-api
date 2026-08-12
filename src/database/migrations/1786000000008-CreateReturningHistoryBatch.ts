import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * "Salida de Devoluciones y Recolecciones" (lote).
 *
 * DEFENSIVA a propósito: la tabla `returning_history` y las columnas `returningHistoryId`
 * de `devolution`/`collection` fueron creadas históricamente por un `synchronize` (nunca por
 * migración), así que pueden EXISTIR ya con el esquema viejo (solo id + date) o NO existir en
 * un entorno limpio. Por eso todo se hace con checks a information_schema en vez de ADD/CREATE
 * a ciegas.
 */
export class CreateReturningHistoryBatch1786000000008 implements MigrationInterface {
  name = 'CreateReturningHistoryBatch1786000000008'

  private async tableExists(qr: QueryRunner, table: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return Number(rows[0].c) > 0;
  }

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
    // 1. Tabla base del lote (crear completa si no existe; si existe, completar columnas).
    if (!(await this.tableExists(queryRunner, 'returning_history'))) {
      await queryRunner.query(`
        CREATE TABLE \`returning_history\` (
          \`id\` varchar(36) NOT NULL,
          \`folio\` int NOT NULL AUTO_INCREMENT,
          \`date\` timestamp NOT NULL,
          \`subsidiaryId\` varchar(36) NULL,
          \`vehicleId\` varchar(36) NULL,
          \`devolutionsCount\` int NOT NULL DEFAULT 0,
          \`collectionsCount\` int NOT NULL DEFAULT 0,
          \`createdById\` char(36) NULL,
          \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`IDX_returning_history_folio\` (\`folio\`),
          INDEX \`IDX_returning_history_subsidiary\` (\`subsidiaryId\`)
        )
      `);
    } else {
      // La tabla ya existía (synchronize) con esquema viejo: agregar solo lo que falte.
      await this.addColumnIfMissing(queryRunner, 'returning_history', 'subsidiaryId', '`subsidiaryId` varchar(36) NULL');
      await this.addColumnIfMissing(queryRunner, 'returning_history', 'vehicleId', '`vehicleId` varchar(36) NULL');
      await this.addColumnIfMissing(queryRunner, 'returning_history', 'devolutionsCount', '`devolutionsCount` int NOT NULL DEFAULT 0');
      await this.addColumnIfMissing(queryRunner, 'returning_history', 'collectionsCount', '`collectionsCount` int NOT NULL DEFAULT 0');
      await this.addColumnIfMissing(queryRunner, 'returning_history', 'createdById', '`createdById` char(36) NULL');
      await this.addColumnIfMissing(queryRunner, 'returning_history', 'createdAt', '`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');
      if (!(await this.columnExists(queryRunner, 'returning_history', 'folio'))) {
        // AUTO_INCREMENT exige índice: el UNIQUE lo satisface y numera las filas existentes.
        await queryRunner.query(
          `ALTER TABLE \`returning_history\` ADD COLUMN \`folio\` int NOT NULL AUTO_INCREMENT UNIQUE`,
        );
      }
      if (!(await this.columnExists(queryRunner, 'returning_history', 'subsidiaryId'))) {
        // (por si acaso) ya cubierto arriba; no-op.
      }
    }

    // 2. Tabla puente de choferes (varios por salida).
    if (!(await this.tableExists(queryRunner, 'returning_history_drivers'))) {
      await queryRunner.query(`
        CREATE TABLE \`returning_history_drivers\` (
          \`returningHistoryId\` varchar(36) NOT NULL,
          \`driverId\` varchar(36) NOT NULL,
          PRIMARY KEY (\`returningHistoryId\`, \`driverId\`),
          INDEX \`IDX_rhd_driver\` (\`driverId\`)
        )
      `);
    }

    // 3. Asegurar el FK returningHistoryId en devolution / collection (predatan como synchronize).
    await this.addColumnIfMissing(queryRunner, 'devolution', 'returningHistoryId', '`returningHistoryId` varchar(36) NULL');
    await this.addColumnIfMissing(queryRunner, 'collection', 'returningHistoryId', '`returningHistoryId` varchar(36) NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.tableExists(queryRunner, 'returning_history_drivers')) {
      await queryRunner.query(`DROP TABLE \`returning_history_drivers\``);
    }
    // Solo revertimos las columnas que ESTA migración agrega; no tocamos `id`/`date` ni la tabla
    // base (predataba a esta migración por synchronize).
    for (const col of ['folio', 'subsidiaryId', 'vehicleId', 'devolutionsCount', 'collectionsCount', 'createdById', 'createdAt']) {
      if (await this.columnExists(queryRunner, 'returning_history', col)) {
        await queryRunner.query(`ALTER TABLE \`returning_history\` DROP COLUMN \`${col}\``);
      }
    }
  }
}
