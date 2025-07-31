import { MigrationInterface, QueryRunner } from "typeorm";

export class VehicleAddCapacity1753929456909 implements MigrationInterface {
    name = 'VehicleAddCapacity1753929456909'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`vehicle\` ADD \`capacity\` int NOT NULL DEFAULT '100'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`vehicle\` DROP COLUMN \`capacity\``);
    }

}
