import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Folio de captura del desembarque (`unloading.clientRequestId`). Lo genera el front al empezar
 * cada captura; si el mismo folio llega dos veces (reintento de red, doble pestaña) el backend
 * regresa el desembarque existente en vez de crear un duplicado. Los registros anteriores quedan
 * en NULL (el índice único permite varios NULL en MySQL).
 */
export class UnloadingClientRequestId1786000000123 implements MigrationInterface {
  name = 'UnloadingClientRequestId1786000000123';

  public async up(q: QueryRunner): Promise<void> {
    const cols: any[] = await q.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unloading' AND COLUMN_NAME = 'clientRequestId'`,
    );
    if (Number(cols?.[0]?.n) === 0) {
      await q.query('ALTER TABLE `unloading` ADD COLUMN `clientRequestId` varchar(64) NULL');
    }
    const idx: any[] = await q.query(
      `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unloading' AND INDEX_NAME = 'UQ_unloading_clientRequestId'`,
    );
    if (Number(idx?.[0]?.n) === 0) {
      await q.query('CREATE UNIQUE INDEX `UQ_unloading_clientRequestId` ON `unloading` (`clientRequestId`)');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX `UQ_unloading_clientRequestId` ON `unloading`');
    await q.query('ALTER TABLE `unloading` DROP COLUMN `clientRequestId`');
  }
}
