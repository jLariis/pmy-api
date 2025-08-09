import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCodeToRoutesChangeName1754692085721 implements MigrationInterface {
    name = 'AddCodeToRoutesChangeName1754692085721'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`route\` CHANGE \`codigo\` \`code\` varchar(255) NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`code\``);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`code\` varchar(255) NULL DEFAULT ''`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`code\``);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`code\` varchar(255) NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`route\` CHANGE \`code\` \`codigo\` varchar(255) NULL DEFAULT ''`);
    }

}
