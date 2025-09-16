import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReturningHistory1757544731043 implements MigrationInterface {
    name = 'AddReturningHistory1757544731043'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`returning_history\` (\`id\` varchar(36) NOT NULL, \`date\` timestamp NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`devolution\` ADD \`returningHistoryId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`collection\` ADD \`returningHistoryId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`devolution\` ADD CONSTRAINT \`FK_2a89dc6c0800762e17e1cb6d557\` FOREIGN KEY (\`returningHistoryId\`) REFERENCES \`returning_history\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`collection\` ADD CONSTRAINT \`FK_096578bff5e36ccfac46c73c57f\` FOREIGN KEY (\`returningHistoryId\`) REFERENCES \`returning_history\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`collection\` DROP FOREIGN KEY \`FK_096578bff5e36ccfac46c73c57f\``);
        await queryRunner.query(`ALTER TABLE \`devolution\` DROP FOREIGN KEY \`FK_2a89dc6c0800762e17e1cb6d557\``);
        await queryRunner.query(`ALTER TABLE \`collection\` DROP COLUMN \`returningHistoryId\``);
        await queryRunner.query(`ALTER TABLE \`devolution\` DROP COLUMN \`returningHistoryId\``);
        await queryRunner.query(`DROP TABLE \`returning_history\``);
    }

}
