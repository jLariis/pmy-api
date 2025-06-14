import { MigrationInterface, QueryRunner } from "typeorm";

export class ShipmentChanges1749751160858 implements MigrationInterface {
    name = 'ShipmentChanges1749751160858'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`isNotIndividualBilling\` \`isPartOfCharge\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`isPartOfCharge\` tinyint NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`isPartOfCharge\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`isPartOfCharge\` \`isNotIndividualBilling\` tinyint NOT NULL DEFAULT '0'`);
    }

}
