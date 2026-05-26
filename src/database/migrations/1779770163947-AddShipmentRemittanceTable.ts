import { MigrationInterface, QueryRunner } from "typeorm";

export class AddShipmentRemittanceTable1779770163947 implements MigrationInterface {
    name = 'AddShipmentRemittanceTable1779770163947'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE \`shipment_remittance\` (
                \`id\` varchar(36) NOT NULL,
                \`pieceTrackingNumber\` varchar(25) NOT NULL,
                \`shipmentId\` varchar(255) NULL,
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB
        `);

        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            ADD CONSTRAINT \`FK_e2db6511bf0308fc543132e3e8b\`
            FOREIGN KEY (\`shipmentId\`)
            REFERENCES \`shipment\`(\`id\`)
            ON DELETE NO ACTION
            ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            DROP FOREIGN KEY \`FK_e2db6511bf0308fc543132e3e8b\`
        `);

        await queryRunner.query(`
            DROP TABLE \`shipment_remittance\`
        `);
    }
}