import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCollectionsToRouteClosure1756772460291 implements MigrationInterface {
    name = 'AddCollectionsToRouteClosure1756772460291'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`route_closure\` ADD \`collecctons\` json NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`route_closure\` DROP COLUMN \`collecctons\``);
    }

}
