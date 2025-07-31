import { MigrationInterface, QueryRunner } from "typeorm";

export class VehicleAddCode1753920453794 implements MigrationInterface {
    name = 'VehicleAddCode1753920453794'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`vehicle\` ADD \`code\` varchar(255) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`vehicle\` DROP COLUMN \`code\``);
    }

}
