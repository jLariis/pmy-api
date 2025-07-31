import { MigrationInterface, QueryRunner } from "typeorm";

export class VehicleAddType1753924532886 implements MigrationInterface {
    name = 'VehicleAddType1753924532886'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`vehicle\` ADD \`type\` enum ('van', 'camioneta', 'rabon', '3/4', 'urban', 'caja larga') NOT NULL DEFAULT 'van'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`vehicle\` DROP COLUMN \`type\``);
    }

}
