import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreatedByInExpenses1775967522929 implements MigrationInterface {
    name = 'AddCreatedByInExpenses1775967522929'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD CONSTRAINT \`FK_33025f4898ea79cc35a3c6da4ca\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` DROP FOREIGN KEY \`FK_33025f4898ea79cc35a3c6da4ca\``);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`createdById\``);
    }

}
