import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { CATALOG_DEFS, deriveItems } from '../../catalog/catalog-definition';

/**
 * Catálogo genérico de enums. Crea `catalog_item` y SIEMBRA todos los enums del
 * sistema (unión front+back, sin duplicados) derivados de los enums reales.
 * Todos los valores sembrados quedan `isSystem=1` (protegidos de borrado; el
 * código sigue usando las keys). Idempotente: solo siembra los types vacíos.
 */
export class AddCatalogItems1786000000009 implements MigrationInterface {
  name = 'AddCatalogItems1786000000009';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`catalog_item\` (
        \`id\`        VARCHAR(36)  NOT NULL,
        \`type\`      VARCHAR(60)  NOT NULL,
        \`key\`       VARCHAR(120) NOT NULL,
        \`label\`     VARCHAR(150) NOT NULL,
        \`sortOrder\` INT          NOT NULL DEFAULT 0,
        \`active\`    TINYINT(1)   NOT NULL DEFAULT 1,
        \`isSystem\`  TINYINT(1)   NOT NULL DEFAULT 0,
        \`createdAt\` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_catalog_type_key\` (\`type\`, \`key\`),
        KEY \`idx_catalog_type\` (\`type\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    for (const def of CATALOG_DEFS) {
      const count: any[] = await q.query(`SELECT COUNT(*) AS c FROM \`catalog_item\` WHERE \`type\` = ?`, [def.type]);
      if (Number(count?.[0]?.c ?? 0) > 0) continue; // ya sembrado
      for (const it of deriveItems(def)) {
        await q.query(
          `INSERT INTO \`catalog_item\` (\`id\`, \`type\`, \`key\`, \`label\`, \`sortOrder\`, \`active\`, \`isSystem\`) VALUES (?, ?, ?, ?, ?, 1, 1)`,
          [randomUUID(), it.type, it.key, it.label, it.sortOrder],
        );
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS \`catalog_item\``);
  }
}
