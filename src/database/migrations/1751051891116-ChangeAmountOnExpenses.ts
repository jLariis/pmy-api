import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeAmountOnExpenses1751051891116 implements MigrationInterface {
    name = 'ChangeAmountOnExpenses1751051891116'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` CHANGE \`amount\` \`amount\` decimal(10,2) NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` CHANGE \`amount\` \`amount\` decimal(10,0) NOT NULL`);
    }

}
