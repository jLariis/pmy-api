import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangesOnCharge1750463233997 implements MigrationInterface {
    name = 'ChangesOnCharge1750463233997'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`charge\` DROP FOREIGN KEY \`FK_5f87a68dc513d9b79b9d158246a\``);
        await queryRunner.query(`DROP INDEX \`REL_5f87a68dc513d9b79b9d158246\` ON \`charge\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`trackingNumber\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`shipmentType\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`recipientName\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`recipientAddress\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`recipientCity\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`recipientZip\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`commitDate\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`commitTime\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`recipientPhone\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`status\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`priority\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`consNumber\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`receivedByName\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`paymentId\``);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`paymentId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`receivedByName\` varchar(255) NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`consNumber\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`priority\` enum ('alta', 'media', 'baja') NOT NULL DEFAULT 'baja'`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`recipientPhone\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`commitTime\` time NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`commitDate\` date NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`recipientZip\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`recipientCity\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`recipientAddress\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`recipientName\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`shipmentType\` enum ('fedex', 'dhl') NOT NULL DEFAULT 'fedex'`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`trackingNumber\` varchar(255) NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`REL_5f87a68dc513d9b79b9d158246\` ON \`charge\` (\`paymentId\`)`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD CONSTRAINT \`FK_5f87a68dc513d9b79b9d158246a\` FOREIGN KEY (\`paymentId\`) REFERENCES \`payment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}
