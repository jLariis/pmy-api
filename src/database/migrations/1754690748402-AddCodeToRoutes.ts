import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCodeToRoutes1754690748402 implements MigrationInterface {
    name = 'AddCodeToRoutes1754690748402'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`codigo\` varchar(255) NULL DEFAULT ''`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`codigo\``);
    }

}
