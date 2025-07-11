import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatesForPreventInconsistency1752090228871 implements MigrationInterface {
    name = 'UpdatesForPreventInconsistency1752090228871'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP COLUMN \`commitDate\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP COLUMN \`commitTime\``);
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`cost\``);
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`notDeliveryStatus\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP COLUMN \`commitDate\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP COLUMN \`commitTime\``);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`updatedAt\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`vehicle\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`vehicle\` ADD \`updatedAt\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`updatedAt\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`payment\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD \`commitDateTime\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`user\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`user\` ADD \`updatedAt\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`nonDeliveryStatus\` varchar(255) NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`expense\` ADD \`updatedAt\` datetime NULL`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD \`commitDateTime\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`status\``);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`status\` enum ('En progreso', 'Completada', 'Pendiente', 'Cancelada') NOT NULL DEFAULT 'Pendiente'`);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`startTime\``);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`startTime\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`estimatedArrival\``);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`estimatedArrival\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` DROP COLUMN \`timestamp\``);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` ADD \`timestamp\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`user\` DROP FOREIGN KEY \`FK_e64207879afbccc4bb63a40d1f5\``);
        await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`user\` ADD \`subsidiaryId\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`collection\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`collection\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`shipmentType\``);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`shipmentType\` enum ('fedex', 'dhl') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`incomeType\``);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`incomeType\` enum ('entregado', 'no_entregado') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`consolidated\` DROP COLUMN \`date\``);
        await queryRunner.query(`ALTER TABLE \`consolidated\` ADD \`date\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`consolidated\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`consolidated\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`user\` ADD CONSTRAINT \`FK_e64207879afbccc4bb63a40d1f5\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`user\` DROP FOREIGN KEY \`FK_e64207879afbccc4bb63a40d1f5\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD \`createdAt\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`consolidated\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`consolidated\` ADD \`createdAt\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`consolidated\` DROP COLUMN \`date\``);
        await queryRunner.query(`ALTER TABLE \`consolidated\` ADD \`date\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`createdAt\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`incomeType\``);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`incomeType\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`shipmentType\``);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`shipmentType\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`collection\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`collection\` ADD \`createdAt\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`subsidiaryId\``);
        await queryRunner.query(`ALTER TABLE \`user\` ADD \`subsidiaryId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`user\` ADD CONSTRAINT \`FK_e64207879afbccc4bb63a40d1f5\` FOREIGN KEY (\`subsidiaryId\`) REFERENCES \`subsidiary\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` DROP COLUMN \`timestamp\``);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` ADD \`timestamp\` timestamp(3) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD \`createdAt\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`estimatedArrival\``);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`estimatedArrival\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`startTime\``);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`startTime\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`status\``);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`status\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP COLUMN \`commitDateTime\``);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`updatedAt\``);
        await queryRunner.query(`ALTER TABLE \`expense\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`income\` DROP COLUMN \`nonDeliveryStatus\``);
        await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`updatedAt\``);
        await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`shipment\` DROP COLUMN \`commitDateTime\``);
        await queryRunner.query(`ALTER TABLE \`payment\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`updatedAt\``);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`vehicle\` DROP COLUMN \`updatedAt\``);
        await queryRunner.query(`ALTER TABLE \`vehicle\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`updatedAt\``);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`createdAt\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD \`commitTime\` time NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD \`commitDate\` date NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`notDeliveryStatus\` varchar(255) NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE \`income\` ADD \`cost\` decimal NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD \`commitTime\` time NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` ADD \`commitDate\` date NOT NULL`);
    }

}
