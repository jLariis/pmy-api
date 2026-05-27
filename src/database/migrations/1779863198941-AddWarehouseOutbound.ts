import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWarehouseOutbound1779863198941 implements MigrationInterface {
  name = 'AddWarehouseOutbound1779863198941'

  public async up(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`
      CREATE TABLE \`warehouse_outbound\` (
        \`id\` varchar(36) NOT NULL,
        \`warehouseId\` varchar(255) NULL,
        \`shipments\` json NOT NULL,
        \`type\` enum ('dispatch', 'transfer') NOT NULL,
        \`destinationId\` varchar(255) NULL,
        \`kms\` int NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`vehicleId\` varchar(36) NULL,
        \`createdById\` varchar(36) NULL,
        PRIMARY KEY (\`id\`)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE \`warehouse_outbound_drivers\` (
        \`warehouseOutboundId\` varchar(36) NOT NULL,
        \`driverId\` varchar(36) NOT NULL,
        INDEX \`IDX_086fd3307cd6a16ef4357194b2\` (\`warehouseOutboundId\`),
        INDEX \`IDX_078310ff54c4d2410b2c47d53c\` (\`driverId\`),
        PRIMARY KEY (\`warehouseOutboundId\`, \`driverId\`)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE \`warehouse_outbound_routes\` (
        \`warehouseOutboundId\` varchar(36) NOT NULL,
        \`routeId\` varchar(36) NOT NULL,
        INDEX \`IDX_3b90678c1562952e2d32e88a4e\` (\`warehouseOutboundId\`),
        INDEX \`IDX_abf2cc7221866cfbd42ce85f05\` (\`routeId\`),
        PRIMARY KEY (\`warehouseOutboundId\`, \`routeId\`)
      )
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound\`
      ADD CONSTRAINT \`FK_a8bb35053d65b0812b5fccc11e1\`
      FOREIGN KEY (\`warehouseId\`)
      REFERENCES \`subsidiary\`(\`id\`)
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound\`
      ADD CONSTRAINT \`FK_fd9e010da2eb98c74611995adda\`
      FOREIGN KEY (\`vehicleId\`)
      REFERENCES \`vehicle\`(\`id\`)
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound\`
      ADD CONSTRAINT \`FK_370543ec72a1a0120354a371455\`
      FOREIGN KEY (\`createdById\`)
      REFERENCES \`user\`(\`id\`)
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound_drivers\`
      ADD CONSTRAINT \`FK_086fd3307cd6a16ef4357194b24\`
      FOREIGN KEY (\`warehouseOutboundId\`)
      REFERENCES \`warehouse_outbound\`(\`id\`)
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound_drivers\`
      ADD CONSTRAINT \`FK_078310ff54c4d2410b2c47d53cd\`
      FOREIGN KEY (\`driverId\`)
      REFERENCES \`driver\`(\`id\`)
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound_routes\`
      ADD CONSTRAINT \`FK_3b90678c1562952e2d32e88a4ec\`
      FOREIGN KEY (\`warehouseOutboundId\`)
      REFERENCES \`warehouse_outbound\`(\`id\`)
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound_routes\`
      ADD CONSTRAINT \`FK_abf2cc7221866cfbd42ce85f05f\`
      FOREIGN KEY (\`routeId\`)
      REFERENCES \`route\`(\`id\`)
      ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound_routes\`
      DROP FOREIGN KEY \`FK_abf2cc7221866cfbd42ce85f05f\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound_routes\`
      DROP FOREIGN KEY \`FK_3b90678c1562952e2d32e88a4ec\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound_drivers\`
      DROP FOREIGN KEY \`FK_078310ff54c4d2410b2c47d53cd\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound_drivers\`
      DROP FOREIGN KEY \`FK_086fd3307cd6a16ef4357194b24\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound\`
      DROP FOREIGN KEY \`FK_370543ec72a1a0120354a371455\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound\`
      DROP FOREIGN KEY \`FK_fd9e010da2eb98c74611995adda\`
    `);

    await queryRunner.query(`
      ALTER TABLE \`warehouse_outbound\`
      DROP FOREIGN KEY \`FK_a8bb35053d65b0812b5fccc11e1\`
    `);

    await queryRunner.query(`DROP TABLE \`warehouse_outbound_routes\``);
    await queryRunner.query(`DROP TABLE \`warehouse_outbound_drivers\``);
    await queryRunner.query(`DROP TABLE \`warehouse_outbound\``);
  }
}