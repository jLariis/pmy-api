import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNewColumnsToSubsidiary1779077899663 implements MigrationInterface {
    name = 'AddNewColumnsToSubsidiary1779077899663'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`tycoAmount\` decimal(10,2) NOT NULL DEFAULT '0.00'`);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`airportAmount\` decimal(10,2) NOT NULL DEFAULT '0.00'`);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`secondAbordAmount\` decimal(10,2) NOT NULL DEFAULT '0.00'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`secondAbordAmount\``);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`airportAmount\``);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`tycoAmount\``);
    }

}
