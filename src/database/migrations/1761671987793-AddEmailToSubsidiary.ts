import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailToSubsidiary1761671987793 implements MigrationInterface {
    name = 'AddEmailToSubsidiary1761671987793'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`officeEmail\` varchar(255) NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`officeEmailToCopy\` varchar(255) NULL DEFAULT ''`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`officeEmailToCopy\``);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`officeEmail\``);
    }

}
