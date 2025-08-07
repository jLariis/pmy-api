import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentTypeToPayment1754428685210 implements MigrationInterface {
    name = 'AddPaymentTypeToPayment1754428685210'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`payment\` ADD \`type\` enum ('FTC', 'COD', 'ROD') NOT NULL DEFAULT 'COD'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`payment\` DROP COLUMN \`type\``);
    }

}
