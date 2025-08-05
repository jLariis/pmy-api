import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlateNumberAndPolicyToVehicle1754371151404 implements MigrationInterface {
    name = 'AddPlateNumberAndPolicyToVehicle1754371151404'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`vehicle\` ADD \`policyExpirationDate\` datetime NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`vehicle\` DROP COLUMN \`policyExpirationDate\``);
    }

}
