import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStatusHistoryToCharge1768597249269 implements MigrationInterface {
  name = 'AddStatusHistoryToCharge1768597249269';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /**
     * 1️⃣ Agregar columna (NO afecta datos existentes)
     */
    await queryRunner.query(`
      ALTER TABLE shipment_status
      ADD COLUMN chargeShipmentId varchar(36) NULL
    `);

    /**
     * 2️⃣ Crear índice (opcional pero recomendado)
     */
    await queryRunner.query(`
      CREATE INDEX IDX_shipment_status_chargeShipmentId
      ON shipment_status (chargeShipmentId)
    `);

    /**
     * 3️⃣ Crear FOREIGN KEY
     */
    await queryRunner.query(`
      ALTER TABLE shipment_status
      ADD CONSTRAINT FK_shipment_status_chargeShipment
      FOREIGN KEY (chargeShipmentId)
      REFERENCES charge_shipment(id)
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /**
     * Revertir en orden inverso
     */
    await queryRunner.query(`
      ALTER TABLE shipment_status
      DROP FOREIGN KEY FK_shipment_status_chargeShipment
    `);

    await queryRunner.query(`
      DROP INDEX IDX_shipment_status_chargeShipmentId
      ON shipment_status
    `);

    await queryRunner.query(`
      ALTER TABLE shipment_status
      DROP COLUMN chargeShipmentId
    `);
  }
}
