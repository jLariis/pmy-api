import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSecondAboardAmountToTransfer1779079170235 implements MigrationInterface {
    name = 'AddSecondAboardAmountToTransfer1779079170235'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`transfer\` ADD \`secondAboardAmount\` decimal(10,2) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`transfer\` DROP COLUMN \`secondAboardAmount\``);
    }

}
