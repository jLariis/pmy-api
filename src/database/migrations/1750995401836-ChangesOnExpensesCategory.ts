import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangesOnExpensesCategory1750995401836 implements MigrationInterface {
    name = 'ChangesOnExpensesCategory1750995401836'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`category\` enum ('Nómina', 'Renta', 'Recarga', 'Peajes', 'Servicios', 'Combustible', 'Otros gastos', 'Mantenimiento', 'Impuestos', 'Seguros') NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`category\``);
    }

}
