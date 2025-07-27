import { MigrationInterface, QueryRunner } from "typeorm";

export class AddExceptionCodeToChargeShipment1753480034495 implements MigrationInterface {
    name = 'AddExceptionCodeToChargeShipment1753480034495'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD \`exceptionCode\` varchar(255) NOT NULL DEFAULT ''`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP COLUMN \`exceptionCode\``);
    }

}
