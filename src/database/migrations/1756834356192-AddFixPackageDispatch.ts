import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFixPackageDispatch1756834356192 implements MigrationInterface {
    name = 'AddFixPackageDispatch1756834356192'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`route_closure\` DROP COLUMN \`collecctons\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` ADD \`closedAt\` timestamp NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD UNIQUE INDEX \`IDX_c4c4fec7dfe37214dd95410c84\` (\`trackingNumber\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP INDEX \`IDX_c4c4fec7dfe37214dd95410c84\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP COLUMN \`closedAt\``);
        await queryRunner.query(`ALTER TABLE \`route_closure\` ADD \`collecctons\` json NOT NULL`);
    }

}
