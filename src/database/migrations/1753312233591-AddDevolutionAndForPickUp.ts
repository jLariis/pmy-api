import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDevolutionAndForPickUp1753312233591 implements MigrationInterface {
    name = 'AddDevolutionAndForPickUp1753312233591'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`for-pick-up\` (\`id\` varchar(36) NOT NULL, \`trackingNumber\` varchar(255) NOT NULL, \`date\` datetime NOT NULL, \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP, \`subsidiaryId\` varchar(36) NULL, INDEX \`IDX_e13cf2b7d973d97e0145401a44\` (\`id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`devolution\` (\`id\` varchar(36) NOT NULL, \`trackingNumber\` varchar(255) NOT NULL, \`reason\` varchar(255) NOT NULL, \`date\` datetime NOT NULL, \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP, \`subsidiaryId\` varchar(36) NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` ADD CONSTRAINT \`FK_7faf93e047f5d6b27d64ec4b707\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`devolution\` ADD CONSTRAINT \`FK_26fa708290c4c0d29098e36dd26\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`devolution\` DROP FOREIGN KEY \`FK_26fa708290c4c0d29098e36dd26\``);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` DROP FOREIGN KEY \`FK_7faf93e047f5d6b27d64ec4b707\``);
        await queryRunner.query(`DROP TABLE \`devolution\``);
        await queryRunner.query(`DROP INDEX \`IDX_e13cf2b7d973d97e0145401a44\` ON \`for-pick-up\``);
        await queryRunner.query(`DROP TABLE \`for-pick-up\``);
    }

}
