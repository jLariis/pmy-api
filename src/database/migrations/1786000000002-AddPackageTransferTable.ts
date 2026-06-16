import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Crea la tabla `package_transfer`: traspasos de un paquete entre sucursales
 * para corregir un mal enrutamiento (registrados desde inventario / salida a ruta).
 */
export class AddPackageTransferTable1786000000002 implements MigrationInterface {
  name = 'AddPackageTransferTable1786000000002'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`package_transfer\` (
        \`id\` varchar(36) NOT NULL,
        \`trackingNumber\` varchar(255) NOT NULL,
        \`originId\` varchar(36) NULL,
        \`destinationId\` varchar(36) NULL,
        \`shipmentId\` varchar(36) NULL,
        \`chargeShipmentId\` varchar(36) NULL,
        \`source\` varchar(255) NULL,
        \`reason\` varchar(255) NULL,
        \`createdById\` varchar(36) NULL,
        \`date\` datetime NOT NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX \`IDX_package_transfer_id\` (\`id\`),
        PRIMARY KEY (\`id\`)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`package_transfer\``);
  }
}
