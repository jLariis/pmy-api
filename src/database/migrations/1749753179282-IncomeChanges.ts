import { MigrationInterface, QueryRunner } from "typeorm";

export class IncomeChanges1749753179282 implements MigrationInterface {
    name = 'IncomeChanges1749753179282'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`income\` CHANGE \`incomeSubType\` \`notDeliveryStatus\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`notDeliveryStatus\``);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`notDeliveryStatus\` varchar(255) NULL DEFAULT ''`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`notDeliveryStatus\``);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`notDeliveryStatus\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` CHANGE \`notDeliveryStatus\` \`incomeSubType\` varchar(255) NULL`);
    }

}
