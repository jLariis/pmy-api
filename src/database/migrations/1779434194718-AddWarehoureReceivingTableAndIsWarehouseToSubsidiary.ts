import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWarehoureReceivingTableAndIsWarehouseToSubsidiary1779434194718 implements MigrationInterface {
    name = 'AddWarehoureReceivingTableAndIsWarehouseToSubsidiary1779434194718'

    public async up(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`
      ALTER TABLE subsidiary
      ADD isWarehouse bit NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      CREATE TABLE warehouse_receiving (
        id varchar(36) NOT NULL,
        warehouseId varchar(36) NULL,
        vehicleId varchar(36) NULL,
        createdById varchar(36) NULL,
        shipments json NOT NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE warehouse_receiving_drivers (
        warehouseReceivingId varchar(36) NOT NULL,
        driverId varchar(36) NOT NULL,
        INDEX IDX_WR_DRIVER_WR (warehouseReceivingId),
        INDEX IDX_WR_DRIVER_DRIVER (driverId),
        PRIMARY KEY (warehouseReceivingId, driverId)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      ALTER TABLE warehouse_receiving
      ADD CONSTRAINT FK_WR_WAREHOUSE
      FOREIGN KEY (warehouseId)
      REFERENCES subsidiary(id)
      ON DELETE SET NULL
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE warehouse_receiving
      ADD CONSTRAINT FK_WR_VEHICLE
      FOREIGN KEY (vehicleId)
      REFERENCES vehicle(id)
      ON DELETE SET NULL
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE warehouse_receiving
      ADD CONSTRAINT FK_WR_CREATED_BY
      FOREIGN KEY (createdById)
      REFERENCES user(id)
      ON DELETE SET NULL
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE warehouse_receiving_drivers
      ADD CONSTRAINT FK_WR_DRIVER_WR
      FOREIGN KEY (warehouseReceivingId)
      REFERENCES warehouse_receiving(id)
      ON DELETE CASCADE
      ON UPDATE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE warehouse_receiving_drivers
      ADD CONSTRAINT FK_WR_DRIVER_DRIVER
      FOREIGN KEY (driverId)
      REFERENCES driver(id)
      ON DELETE CASCADE
      ON UPDATE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`
      ALTER TABLE warehouse_receiving_drivers
      DROP FOREIGN KEY FK_WR_DRIVER_DRIVER
    `);

    await queryRunner.query(`
      ALTER TABLE warehouse_receiving_drivers
      DROP FOREIGN KEY FK_WR_DRIVER_WR
    `);

    await queryRunner.query(`
      ALTER TABLE warehouse_receiving
      DROP FOREIGN KEY FK_WR_CREATED_BY
    `);

    await queryRunner.query(`
      ALTER TABLE warehouse_receiving
      DROP FOREIGN KEY FK_WR_VEHICLE
    `);

    await queryRunner.query(`
      ALTER TABLE warehouse_receiving
      DROP FOREIGN KEY FK_WR_WAREHOUSE
    `);

    await queryRunner.query(`
      DROP TABLE warehouse_receiving_drivers
    `);

    await queryRunner.query(`
      DROP TABLE warehouse_receiving
    `);

    await queryRunner.query(`
      ALTER TABLE subsidiary
      DROP COLUMN isWarehouse
    `);
  }

}
