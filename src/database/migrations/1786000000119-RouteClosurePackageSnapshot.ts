import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foto del cierre: estatus y código con los que quedó cada guía/carga de la salida en el
 * momento de cerrarla. Lo muestra "Ver salida" (columna "Al cerrar") y no cambia aunque
 * la guía se corrija después. Los cierres anteriores a esta tabla se reconstruyen del
 * historial de estatus (`shipment_status`).
 */
export class RouteClosurePackageSnapshot1786000000119 implements MigrationInterface {
  name = 'RouteClosurePackageSnapshot1786000000119';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS \`route_closure_package\` (
        \`id\` varchar(36) NOT NULL,
        \`routeClosureId\` char(36) NOT NULL,
        \`dispatchId\` char(36) NOT NULL,
        \`shipmentId\` char(36) NULL,
        \`chargeShipmentId\` char(36) NULL,
        \`trackingNumber\` varchar(64) NOT NULL,
        \`status\` varchar(64) NOT NULL,
        \`exceptionCode\` varchar(16) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_rcp_dispatch\` (\`dispatchId\`),
        INDEX \`IDX_rcp_closure\` (\`routeClosureId\`)
      ) ENGINE=InnoDB`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS `route_closure_package`');
  }
}
