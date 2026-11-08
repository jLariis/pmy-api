import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `route_zip_coverage`: CPs que atiende cada ruta (historial de salidas + ajustes a mano).
 * Base de las sugerencias de salida a ruta por CP y vencimiento. La tabla nace vacía;
 * se llena con POST /route-zip-coverage/rebuild o con el cron diario.
 */
export class RouteZipCoverage1786000000120 implements MigrationInterface {
  name = 'RouteZipCoverage1786000000120';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`route_zip_coverage\` (
        \`id\` varchar(36) NOT NULL,
        \`routeId\` varchar(36) NOT NULL,
        \`subsidiaryId\` varchar(36) NOT NULL,
        \`zip\` varchar(10) NOT NULL,
        \`city\` varchar(150) NULL,
        \`shipmentCount\` int NOT NULL DEFAULT 0,
        \`share\` decimal(5,4) NOT NULL DEFAULT 0,
        \`source\` varchar(10) NOT NULL DEFAULT 'historial',
        \`status\` varchar(10) NOT NULL DEFAULT 'sugerido',
        \`firstSeenAt\` datetime NULL,
        \`lastSeenAt\` datetime NULL,
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_route_zip_coverage\` (\`routeId\`, \`zip\`),
        INDEX \`IDX_route_zip_coverage_route\` (\`routeId\`),
        INDEX \`IDX_route_zip_coverage_subsidiary\` (\`subsidiaryId\`),
        INDEX \`IDX_route_zip_coverage_zip\` (\`zip\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS `route_zip_coverage`');
  }
}
