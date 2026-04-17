import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFrequencyToExpense1776405046892 implements MigrationInterface {
    name = 'AddFrequencyToExpense1776405046892'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`frequency\` enum ('Único', 'Diario', 'Semanal', 'Mensual', 'Anual') NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`frequency\``);
    }

}
