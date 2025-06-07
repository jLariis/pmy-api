import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCollectionEntity1749300355384 implements MigrationInterface {
    name = 'AddCollectionEntity1749300355384'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`collection\` (\`id\` varchar(36) NOT NULL, \`trackingNumber\` varchar(255) NOT NULL, \`subsidiaryId\` varchar(255) NULL, \`status\` varchar(255) NOT NULL, \`isPickUp\` tinyint NOT NULL, \`createdAt\` varchar(255) NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`user\` DROP FOREIGN KEY \`FK_e64207879afbccc4bb63a40d1f5\``);
        await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`user\` ADD \`subsidiaryId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP FOREIGN KEY \`FK_879bdd4a2a6d42e9f28acaebceb\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD \`subsidiaryId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` DROP COLUMN \`timestamp\``);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` ADD \`timestamp\` timestamp(3) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`user\` ADD CONSTRAINT \`FK_e64207879afbccc4bb63a40d1f5\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD CONSTRAINT \`FK_879bdd4a2a6d42e9f28acaebceb\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`collection\` ADD CONSTRAINT \`FK_c900809667a80db6ec9e3f466c7\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`collection\` DROP FOREIGN KEY \`FK_c900809667a80db6ec9e3f466c7\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP FOREIGN KEY \`FK_879bdd4a2a6d42e9f28acaebceb\``);
        await queryRunner.query(`ALTER TABLE \`user\` DROP FOREIGN KEY \`FK_e64207879afbccc4bb63a40d1f5\``);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` DROP COLUMN \`timestamp\``);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` ADD \`timestamp\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD \`subsidiaryId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD CONSTRAINT \`FK_879bdd4a2a6d42e9f28acaebceb\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`user\` ADD \`subsidiaryId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`user\` ADD CONSTRAINT \`FK_e64207879afbccc4bb63a40d1f5\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`DROP TABLE \`collection\``);
    }

}
