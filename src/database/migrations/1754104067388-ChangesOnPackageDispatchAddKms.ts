import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangesOnPackageDispatchAddKms1754104067388 implements MigrationInterface {
    name = 'ChangesOnPackageDispatchAddKms1754104067388'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` ADD \`kms\` varchar(255) NULL DEFAULT ''`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP COLUMN \`kms\``);
    }

}
