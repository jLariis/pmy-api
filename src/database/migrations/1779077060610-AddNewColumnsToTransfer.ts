import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNewColumnsToTransfer1779077060610 implements MigrationInterface {
    name = 'AddNewColumnsToTransfer1779077060610'

    public async up(queryRunner: QueryRunner): Promise<void> {

        await queryRunner.query(`ALTER TABLE \`transfer\` ADD \`transferDate\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`transfer\` ADD \`secondAbord\` bit NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`transfer\` ADD \`extraAmount\` decimal(10,2) NULL`);
        await queryRunner.query(`ALTER TABLE \`transfer\` ADD \`totalAmount\` decimal(10,2) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`transfer\` DROP COLUMN \`totalAmount\``);
        await queryRunner.query(`ALTER TABLE \`transfer\` DROP COLUMN \`extraAmount\``);
        await queryRunner.query(`ALTER TABLE \`transfer\` DROP COLUMN \`secondAbord\``);
        await queryRunner.query(`ALTER TABLE \`transfer\` DROP COLUMN \`transferDate\``);
    }

}
