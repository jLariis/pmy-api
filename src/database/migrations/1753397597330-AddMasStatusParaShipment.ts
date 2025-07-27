import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMasStatusParaShipment1753397597330 implements MigrationInterface {
    name = 'AddMasStatusParaShipment1753397597330'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`driver\` ADD \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`route\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`vehicle\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`user\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`payment\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`collection\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`charge\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`income\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`expense\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`consolidated\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`consolidated\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`expense\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`collection\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`payment\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`user\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`vehicle\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`route\` CHANGE \`createdAt\` \`createdAt\` datetime NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`driver\` DROP COLUMN \`createdAt\``);
    }

}
