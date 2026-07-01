import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Caché persistente de geocodificación ("ML casero"). Guarda cada dirección
 * resuelta (y, sobre todo, las correcciones MANUALES del usuario) para no volver
 * a pegarle a Nominatim y mejorar con el uso.
 */
export class AddGeocodeCache1786000000019 implements MigrationInterface {
  name = 'AddGeocodeCache1786000000019';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`geocode_cache\` (
        \`id\` varchar(36) NOT NULL,
        \`cacheKey\` varchar(255) NOT NULL,
        \`rawAddress\` varchar(255) NULL,
        \`city\` varchar(255) NULL,
        \`zip\` varchar(255) NULL,
        \`latitude\` decimal(10,7) NOT NULL,
        \`longitude\` decimal(10,7) NOT NULL,
        \`source\` varchar(255) NOT NULL DEFAULT 'address',
        \`manual\` tinyint NOT NULL DEFAULT 0,
        \`hits\` int NOT NULL DEFAULT 1,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` datetime NULL,
        UNIQUE INDEX \`IDX_geocode_cache_key\` (\`cacheKey\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS `geocode_cache`');
  }
}
