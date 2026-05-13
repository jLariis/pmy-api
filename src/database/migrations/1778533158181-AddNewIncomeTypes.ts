import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNewIncomeTypes1778533158181 implements MigrationInterface {
    name = 'AddNewIncomeTypes1778533158181'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` CHANGE \`shipmentType\` \`shipmentType\` enum ('fedex', 'dhl', 'other') NOT NULL DEFAULT 'fedex'`);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`shipmentType\` \`shipmentType\` enum ('fedex', 'dhl', 'other') NOT NULL DEFAULT 'fedex'`); 
        await queryRunner.query(`ALTER TABLE \`income\` CHANGE \`shipmentType\` \`shipmentType\` enum ('fedex', 'dhl', 'other') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` CHANGE \`incomeType\` \`incomeType\` enum ('entregado', 'rechazado', 'no_entregado', 'cliente_no_disponible_3ra_visita', 'tyco', 'aeropuerto', 'traslado_especial') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` CHANGE \`sourceType\` \`sourceType\` enum ('shipment', 'collection', 'charge', 'manual', 'tyco', 'aeropuerto', 'special_transfer') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`consolidated\` CHANGE \`carrier\` \`carrier\` enum ('fedex', 'dhl', 'other') NOT NULL DEFAULT 'fedex'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`consolidated\` CHANGE \`carrier\` \`carrier\` enum ('FEDEX', 'DHL') NOT NULL DEFAULT 'FEDEX'`);
        await queryRunner.query(`ALTER TABLE \`income\` CHANGE \`shipmentType\` \`shipmentType\` enum ('fedex', 'dhl') NOT NULL`); 
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`shipmentType\` \`shipmentType\` enum ('fedex', 'dhl') NOT NULL DEFAULT 'fedex'`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` CHANGE \`shipmentType\` \`shipmentType\` enum ('fedex', 'dhl') NOT NULL DEFAULT 'fedex'`);
    }

}
