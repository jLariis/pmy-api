import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIsHighValue1752817591525 implements MigrationInterface {
    name = 'AddIsHighValue1752817591525'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD \`isHighValue\` tinyint NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP COLUMN \`isHighValue\``);
    }

}
