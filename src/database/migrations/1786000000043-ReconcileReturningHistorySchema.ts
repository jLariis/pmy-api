import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Reconciliador IDEMPOTENTE del esquema de `returning_history`.
 *
 * Motivo: las migraciones 008/009 pudieron aplicarse parcialmente o con el esquema viejo
 * (columna `folio` en vez de `trackingNumber`) — y editar una migración ya ejecutada NO la
 * vuelve a correr. Esta migración va numerada por encima de todas para garantizar que corre,
 * y deja la tabla en su forma final sin importar el estado previo. Todo con guards a
 * information_schema (no falla si algo ya existe / ya no existe).
 */
export class ReconcileReturningHistorySchema1786000000043 implements MigrationInterface {
  name = 'ReconcileReturningHistorySchema1786000000043'

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

  private async indexExists(qr: QueryRunner, table: string, index: string): Promise<boolean> {
    const rows = await qr.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, index],
    );
    return Number(rows[0].c) > 0;
  }

  private async addColumnIfMissing(qr: QueryRunner, table: string, column: string, ddl: string) {
    if (!(await this.columnExists(qr, table, column))) {
      await qr.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // La tabla base ya existe (synchronize/008). Si por alguna razón no, la creamos mínima.
    if (!(await this.tableExists(queryRunner, 'returning_history'))) {
      await queryRunner.query(`
        CREATE TABLE \`returning_history\` (
          \`id\` varchar(36) NOT NULL,
          \`date\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`)
        )
      `);
    }

    // 1. Asegurar TODAS las columnas del esquema final (idempotente).
    await this.addColumnIfMissing(queryRunner, 'returning_history', 'trackingNumber', '`trackingNumber` varchar(255) NULL');
    await this.addColumnIfMissing(queryRunner, 'returning_history', 'subsidiaryId', '`subsidiaryId` varchar(36) NULL');
    await this.addColumnIfMissing(queryRunner, 'returning_history', 'vehicleId', '`vehicleId` varchar(36) NULL');
    await this.addColumnIfMissing(queryRunner, 'returning_history', 'devolutionsCount', '`devolutionsCount` int NOT NULL DEFAULT 0');
    await this.addColumnIfMissing(queryRunner, 'returning_history', 'collectionsCount', '`collectionsCount` int NOT NULL DEFAULT 0');
    await this.addColumnIfMissing(queryRunner, 'returning_history', 'createdById', '`createdById` char(36) NULL');
    await this.addColumnIfMissing(queryRunner, 'returning_history', 'createdAt', '`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP');
    await this.addColumnIfMissing(
      queryRunner, 'returning_history', 'emailStatus',
      "`emailStatus` enum('not_sent','sent','error') NOT NULL DEFAULT 'not_sent'",
    );
    await this.addColumnIfMissing(queryRunner, 'returning_history', 'emailLastSentAt', '`emailLastSentAt` timestamp NULL');
    await this.addColumnIfMissing(queryRunner, 'returning_history', 'emailLastError', '`emailLastError` varchar(500) NULL');

    // 2. Índices.
    if (!(await this.indexExists(queryRunner, 'returning_history', 'IDX_returning_history_tracking'))) {
      await queryRunner.query('CREATE INDEX `IDX_returning_history_tracking` ON `returning_history` (`trackingNumber`)');
    }
    if (!(await this.indexExists(queryRunner, 'returning_history', 'IDX_returning_history_subsidiary'))) {
      await queryRunner.query('CREATE INDEX `IDX_returning_history_subsidiary` ON `returning_history` (`subsidiaryId`)');
    }

    // 3. Backfill de trackingNumber para filas existentes.
    if (await this.columnExists(queryRunner, 'returning_history', 'folio')) {
      // Rows de la era "folio": copiamos el folio como número de rastreo.
      await queryRunner.query(
        "UPDATE `returning_history` SET `trackingNumber` = CAST(`folio` AS CHAR) WHERE (`trackingNumber` IS NULL OR `trackingNumber` = '')",
      );
    }
    // Cualquier fila restante sin trackingNumber: valor estable derivado del uuid (12 chars).
    await queryRunner.query(
      "UPDATE `returning_history` SET `trackingNumber` = LEFT(REPLACE(`id`, '-', ''), 12) WHERE (`trackingNumber` IS NULL OR `trackingNumber` = '')",
    );

    // 4. Quitar `folio` (ya migrado a trackingNumber).
    if (await this.columnExists(queryRunner, 'returning_history', 'folio')) {
      await queryRunner.query('ALTER TABLE `returning_history` DROP COLUMN `folio`');
    }

    // 5. Tabla puente de choferes + FK returningHistoryId (por si 008 no alcanzó a crearlas).
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
    await this.addColumnIfMissing(queryRunner, 'devolution', 'returningHistoryId', '`returningHistoryId` varchar(36) NULL');
    await this.addColumnIfMissing(queryRunner, 'collection', 'returningHistoryId', '`returningHistoryId` varchar(36) NULL');
  }

  public async down(): Promise<void> {
    // Reconciliador idempotente: no se revierte (no romper el esquema final).
  }
}
