import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeUser1749619672166 implements MigrationInterface {
    name = 'ChangeUser1749619672166'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`user\` ADD \`active\` tinyint NULL DEFAULT 1`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`active\``);
    }

}
