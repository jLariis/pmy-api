import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTrackingNumberToUnloading1754706333307 implements MigrationInterface {
    name = 'AddTrackingNumberToUnloading1754706333307'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD \`trackingNumber\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD UNIQUE INDEX \`IDX_c4c4fec7dfe37214dd95410c84\` (\`trackingNumber\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP INDEX \`IDX_c4c4fec7dfe37214dd95410c84\``);
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP COLUMN \`trackingNumber\``);
    }

}
