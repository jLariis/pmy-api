import { MigrationInterface, QueryRunner } from "typeorm";

export class SubsidiaryChanges1750182982608 implements MigrationInterface {
    name = 'SubsidiaryChanges1750182982608'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`isNotIndividualBilling\` \`isPartOfCharge\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`managerPhone\` varchar(255) NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`user\` ADD \`active\` tinyint NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` ADD \`exceptionCode\` varchar(255) NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP FOREIGN KEY \`FK_1704dcc7f9b49f75a8573c8712c\``);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`subsidiaryId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`collection\` CHANGE \`status\` \`status\` varchar(255) NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`collection\` CHANGE \`isPickUp\` \`isPickUp\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD CONSTRAINT \`FK_1704dcc7f9b49f75a8573c8712c\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` DROP FOREIGN KEY \`FK_1704dcc7f9b49f75a8573c8712c\``);
        await queryRunner.query(`ALTER TABLE \`collection\` CHANGE \`isPickUp\` \`isPickUp\` tinyint NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`collection\` CHANGE \`status\` \`status\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`subsidiaryId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD CONSTRAINT \`FK_1704dcc7f9b49f75a8573c8712c\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` DROP COLUMN \`exceptionCode\``);
        await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`active\``);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`managerPhone\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`isPartOfCharge\` \`isNotIndividualBilling\` tinyint NOT NULL DEFAULT '0'`);
    }

}
