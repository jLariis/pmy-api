import { MigrationInterface, QueryRunner } from "typeorm";

export class AddChargeAndChargeShipment1750462324111 implements MigrationInterface {
    name = 'AddChargeAndChargeShipment1750462324111'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`charge\` (\`id\` varchar(36) NOT NULL, \`trackingNumber\` varchar(255) NOT NULL, \`shipmentType\` enum ('fedex', 'dhl') NOT NULL DEFAULT 'fedex', \`recipientName\` varchar(255) NOT NULL, \`recipientAddress\` varchar(255) NOT NULL, \`recipientCity\` varchar(255) NOT NULL, \`recipientZip\` varchar(255) NOT NULL, \`commitDate\` date NOT NULL, \`commitTime\` time NOT NULL, \`recipientPhone\` varchar(255) NOT NULL, \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado') NOT NULL DEFAULT 'pendiente', \`priority\` enum ('alta', 'media', 'baja') NOT NULL DEFAULT 'baja', \`consNumber\` varchar(255) NULL, \`receivedByName\` varchar(255) NOT NULL DEFAULT '', \`createdAt\` varchar(255) NULL, \`subsidiaryId\` varchar(255) NULL, \`chargeDate\` varchar(255) NOT NULL, \`numberOfPackages\` int NOT NULL, \`isChargeComplete\` tinyint NOT NULL DEFAULT 0, \`paymentId\` varchar(36) NULL, UNIQUE INDEX \`REL_5f87a68dc513d9b79b9d158246\` (\`paymentId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`charge_shipment\` (\`id\` varchar(36) NOT NULL, \`trackingNumber\` varchar(255) NOT NULL, \`shipmentType\` enum ('fedex', 'dhl') NOT NULL DEFAULT 'fedex', \`recipientName\` varchar(255) NOT NULL, \`recipientAddress\` varchar(255) NOT NULL, \`recipientCity\` varchar(255) NOT NULL, \`recipientZip\` varchar(255) NOT NULL, \`commitDate\` date NOT NULL, \`commitTime\` time NOT NULL, \`recipientPhone\` varchar(255) NOT NULL, \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado') NOT NULL DEFAULT 'pendiente', \`priority\` enum ('alta', 'media', 'baja') NOT NULL DEFAULT 'baja', \`consNumber\` varchar(255) NULL, \`receivedByName\` varchar(255) NOT NULL DEFAULT '', \`createdAt\` varchar(255) NULL, \`subsidiaryId\` varchar(255) NULL, \`chargeId\` varchar(255) NULL, \`paymentId\` varchar(36) NULL, UNIQUE INDEX \`REL_2944dbee3f9f0ae16a3dac9775\` (\`paymentId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP COLUMN \`isPartOfCharge\``);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD CONSTRAINT \`FK_5f87a68dc513d9b79b9d158246a\` FOREIGN KEY (\`paymentId\`) REFERENCES \`payment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD CONSTRAINT \`FK_bcd9980bcdbd8eaa922ac7d79ca\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD CONSTRAINT \`FK_2944dbee3f9f0ae16a3dac97754\` FOREIGN KEY (\`paymentId\`) REFERENCES \`payment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD CONSTRAINT \`FK_64915b43e255e3edabef6eef1be\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD CONSTRAINT \`FK_aae861e556d3179766cc371b5ca\` FOREIGN KEY (\`chargeId\`) REFERENCES \`charge\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP FOREIGN KEY \`FK_aae861e556d3179766cc371b5ca\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP FOREIGN KEY \`FK_64915b43e255e3edabef6eef1be\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP FOREIGN KEY \`FK_2944dbee3f9f0ae16a3dac97754\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP FOREIGN KEY \`FK_bcd9980bcdbd8eaa922ac7d79ca\``);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP FOREIGN KEY \`FK_5f87a68dc513d9b79b9d158246a\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD \`isPartOfCharge\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`DROP INDEX \`REL_2944dbee3f9f0ae16a3dac9775\` ON \`charge_shipment\``);
        await queryRunner.query(`DROP TABLE \`charge_shipment\``);
        await queryRunner.query(`DROP INDEX \`REL_5f87a68dc513d9b79b9d158246\` ON \`charge\``);
        await queryRunner.query(`DROP TABLE \`charge\``);
    }

}
