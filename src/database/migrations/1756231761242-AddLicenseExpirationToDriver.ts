import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLicenseExpirationToDriver1756231761242 implements MigrationInterface {
    name = 'AddLicenseExpirationToDriver1756231761242'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`driver\` ADD \`licenseExpiration\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`driver\` DROP COLUMN \`licenseExpiration\``);
    }

}
