import { MigrationInterface, QueryRunner } from "typeorm";

export class ShipmentHistoryModifyAddedStatusCode1749681441549 implements MigrationInterface {
    name = 'ShipmentHistoryModifyAddedStatusCode1749681441549'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment_status\` ADD \`exceptionCode\` varchar(255) NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`cost\``);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`cost\` decimal(10,2) NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`cost\``);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`cost\` int NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` DROP COLUMN \`exceptionCode\``);
    }

}
