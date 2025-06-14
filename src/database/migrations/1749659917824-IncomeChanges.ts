import { MigrationInterface, QueryRunner } from "typeorm";

export class IncomeChanges1749659917824 implements MigrationInterface {
    name = 'IncomeChanges1749659917824'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`income\` (\`id\` varchar(36) NOT NULL, \`trackingNumber\` varchar(255) NOT NULL, \`subsidiaryId\` varchar(255) NULL, \`shipmentType\` varchar(255) NOT NULL, \`cost\` int NOT NULL, \`incomeType\` varchar(255) NOT NULL, \`incomeSubType\` varchar(255) NULL, \`date\` datetime NOT NULL, \`createdAt\` varchar(255) NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`managerPhone\` varchar(255) NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP FOREIGN KEY \`FK_1704dcc7f9b49f75a8573c8712c\``);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`subsidiaryId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` ADD CONSTRAINT \`FK_cc91fb161397301a03de0046cf3\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD CONSTRAINT \`FK_1704dcc7f9b49f75a8573c8712c\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`expense\` DROP FOREIGN KEY \`FK_1704dcc7f9b49f75a8573c8712c\``);
        await queryRunner.query(`ALTER TABLE \`income\` DROP FOREIGN KEY \`FK_cc91fb161397301a03de0046cf3\``);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`subsidiaryId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD CONSTRAINT \`FK_1704dcc7f9b49f75a8573c8712c\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`managerPhone\``);
        await queryRunner.query(`DROP TABLE \`income\``);
    }

}
