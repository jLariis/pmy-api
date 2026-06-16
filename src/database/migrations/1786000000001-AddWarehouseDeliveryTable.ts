import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Crea la tabla `warehouse_delivery` para los paquetes ENTREGADOS en bodega
 * (entrega final en sucursal), separándolos de `for-pick-up` (que queda solo
 * para "ocurre", paquetes en espera de ser recogidos).
 */
export class AddWarehouseDeliveryTable1786000000001 implements MigrationInterface {
  name = 'AddWarehouseDeliveryTable1786000000001'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`warehouse_delivery\` (
        \`id\` varchar(36) NOT NULL,
        \`trackingNumber\` varchar(255) NOT NULL,
        \`date\` datetime NOT NULL,
        \`subsidiaryId\` varchar(36) NULL,
        \`createdById\` varchar(36) NULL,
        \`shipmentId\` varchar(36) NULL,
        \`chargeShipmentId\` varchar(36) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX \`IDX_warehouse_delivery_id\` (\`id\`),
        PRIMARY KEY (\`id\`)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`warehouse_delivery\``);
  }
}
