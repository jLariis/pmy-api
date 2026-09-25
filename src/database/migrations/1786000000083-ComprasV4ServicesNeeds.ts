import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { SEED_CATEGORY_KEYWORDS, SEED_SERVICES } from '../seeds/compras-services.seed';

/**
 * Compras v4 (spec 2026-09-24-compras-necesidades-sugerencias-design):
 *  - `service_template` + `service_template_item` (servicios predefinidos con receta opcional).
 *  - `request_service` (servicios elegidos en la solicitud) y `request_need` ("Lo que se necesita").
 *  - Sinónimos en `product_category.keywords`; `maintenance_quote.fromCatalog`; `maintenance_quote_item.requestNeedId`.
 * Idempotente y sin COLLATE explícito.
 */
export class ComprasV4ServicesNeeds1786000000083 implements MigrationInterface {
  name = 'ComprasV4ServicesNeeds1786000000083';

  private async columnExists(q: QueryRunner, table: string, column: string): Promise<boolean> {
    const r = await q.query(
      'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [table, column],
    );
    return Number(r[0].c) > 0;
  }

  private async addColumn(q: QueryRunner, table: string, column: string, ddl: string) {
    if (!(await this.columnExists(q, table, column))) await q.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  }

  public async up(q: QueryRunner): Promise<void> {
    const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    await q.query(`CREATE TABLE IF NOT EXISTS \`service_template\` (
      \`id\` varchar(36) NOT NULL, \`name\` varchar(150) NOT NULL, \`description\` text NULL, \`vehicleType\` varchar(50) NULL,
      \`keywords\` text NULL, \`active\` tinyint(1) NOT NULL DEFAULT 1,
      \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP, \`updatedAt\` datetime NULL,
      PRIMARY KEY (\`id\`), UNIQUE KEY \`uq_service_template_name\` (\`name\`)) ${T}`);
    await q.query(`CREATE TABLE IF NOT EXISTS \`service_template_item\` (
      \`id\` varchar(36) NOT NULL, \`serviceTemplateId\` varchar(36) NOT NULL, \`categoryId\` varchar(36) NOT NULL,
      \`quantity\` decimal(10,2) NOT NULL DEFAULT 1, \`unitId\` varchar(36) NULL, \`sortOrder\` int NOT NULL DEFAULT 0,
      PRIMARY KEY (\`id\`), KEY \`idx_sti_template\` (\`serviceTemplateId\`)) ${T}`);
    await q.query(`CREATE TABLE IF NOT EXISTS \`request_service\` (
      \`id\` varchar(36) NOT NULL, \`requestId\` varchar(36) NOT NULL, \`serviceTemplateId\` varchar(36) NOT NULL,
      \`sortOrder\` int NOT NULL DEFAULT 0,
      PRIMARY KEY (\`id\`), KEY \`idx_rs_request\` (\`requestId\`)) ${T}`);
    await q.query(`CREATE TABLE IF NOT EXISTS \`request_need\` (
      \`id\` varchar(36) NOT NULL, \`requestId\` varchar(36) NOT NULL, \`categoryId\` varchar(36) NOT NULL,
      \`productId\` varchar(36) NULL, \`quantity\` decimal(10,2) NOT NULL DEFAULT 1, \`unitId\` varchar(36) NULL,
      \`source\` enum('receta','ficha','palabra','manual') NOT NULL, \`sourceLabel\` varchar(200) NOT NULL,
      \`dismissed\` tinyint(1) NOT NULL DEFAULT 0, \`sortOrder\` int NOT NULL DEFAULT 0,
      \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`), KEY \`idx_rn_request\` (\`requestId\`)) ${T}`);

    await this.addColumn(q, 'request_need', 'selectedQuoteItemId', 'varchar(36) NULL');
    await this.addColumn(q, 'product_category', 'keywords', 'text NULL');
    await this.addColumn(q, 'maintenance_quote', 'fromCatalog', 'tinyint(1) NOT NULL DEFAULT 0');
    await this.addColumn(q, 'maintenance_quote_item', 'requestNeedId', 'varchar(36) NULL');

    for (const s of SEED_SERVICES) {
      const [row] = await q.query('SELECT COUNT(*) AS c FROM `service_template` WHERE `name` = ?', [s.name]);
      if (Number(row.c) === 0) {
        await q.query('INSERT INTO `service_template` (`id`, `name`, `keywords`, `active`) VALUES (?, ?, ?, 1)', [randomUUID(), s.name, s.keywords]);
      }
    }
    for (const [name, keywords] of Object.entries(SEED_CATEGORY_KEYWORDS)) {
      await q.query('UPDATE `product_category` SET `keywords` = ? WHERE `keywords` IS NULL AND `name` = ?', [keywords, name]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS `request_need`');
    await q.query('DROP TABLE IF EXISTS `request_service`');
    await q.query('DROP TABLE IF EXISTS `service_template_item`');
    await q.query('DROP TABLE IF EXISTS `service_template`');
    if (await this.columnExists(q, 'maintenance_quote_item', 'requestNeedId')) await q.query('ALTER TABLE `maintenance_quote_item` DROP COLUMN `requestNeedId`');
    if (await this.columnExists(q, 'maintenance_quote', 'fromCatalog')) await q.query('ALTER TABLE `maintenance_quote` DROP COLUMN `fromCatalog`');
    if (await this.columnExists(q, 'product_category', 'keywords')) await q.query('ALTER TABLE `product_category` DROP COLUMN `keywords`');
  }
}
