import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangesOnExpenses1750990347219 implements MigrationInterface {
    name = 'ChangesOnExpenses1750990347219'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` DROP FOREIGN KEY \`FK_42eea5debc63f4d1bf89881c10a\``);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`categoryId\``);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`receiptUrl\``);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`receiptUrl\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`categoryId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD CONSTRAINT \`FK_42eea5debc63f4d1bf89881c10a\` FOREIGN KEY (\`categoryId\`) REFERENCES \`expense_category\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}
