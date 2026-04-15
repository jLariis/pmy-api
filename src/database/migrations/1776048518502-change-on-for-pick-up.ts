import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeOnForPickUp1776048518502 implements MigrationInterface {
    name = 'ChangeOnForPickUp1776048518502'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` ADD \`shipmentId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` ADD \`chargeShipmentId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`vehicle\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`vehicle\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`driver\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`driver\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` CHANGE \`status\` \`status\` enum ('recoleccion', 'recibido_en_bodega', 'pendiente', 'en_ruta', 'en_transito', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre', 'en_bodega', 'retorno_abandono_fedex', 'estacion_fedex', 'llegado_despues', 'direccion_incorrecta', 'cliente_no_disponible', 'cambio_fecha_solicitado', 'acargo_de_fedex', 'entregado_por_fedex') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'recibido_en_bodega', 'pendiente', 'en_ruta', 'en_transito', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre', 'en_bodega', 'retorno_abandono_fedex', 'estacion_fedex', 'llegado_despues', 'direccion_incorrecta', 'cliente_no_disponible', 'cambio_fecha_solicitado', 'acargo_de_fedex', 'entregado_por_fedex') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`route_closure\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`route_closure\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`inventory\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`inventory\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` CHANGE \`incomeType\` \`incomeType\` enum ('entregado', 'rechazado', 'no_entregado', 'cliente_no_disponible_3ra_visita') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`consolidated\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`consolidated\` ADD \`createdById\` varchar(255) NULL`);
        await queryRunner.query(`CREATE INDEX \`IDX_4e4bfa8e796759fa76fad57e2a\` ON \`shipment\` (\`fedexUniqueId\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_5a2f2667643784401963f80bfe\` ON \`charge_shipment\` (\`fedexUniqueId\`)`);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` ADD CONSTRAINT \`FK_bc5566207f982fcbb4018f0b77a\` FOREIGN KEY (\`createdById\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` ADD CONSTRAINT \`FK_41154efaa448aa36a6ad30b8b00\` FOREIGN KEY (\`shipmentId\`) REFERENCES \`shipment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` ADD CONSTRAINT \`FK_5f9e2a64cc20ff109057a5ed8bb\` FOREIGN KEY (\`chargeShipmentId\`) REFERENCES \`charge_shipment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` DROP FOREIGN KEY \`FK_5f9e2a64cc20ff109057a5ed8bb\``);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` DROP FOREIGN KEY \`FK_41154efaa448aa36a6ad30b8b00\``);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` DROP FOREIGN KEY \`FK_bc5566207f982fcbb4018f0b77a\``);
        await queryRunner.query(`DROP INDEX \`IDX_5a2f2667643784401963f80bfe\` ON \`charge_shipment\``);
        await queryRunner.query(`DROP INDEX \`IDX_4e4bfa8e796759fa76fad57e2a\` ON \`shipment\``);
        await queryRunner.query(`ALTER TABLE \`consolidated\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`consolidated\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`income\` CHANGE \`incomeType\` \`incomeType\` enum ('entregado', 'no_entregado') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`inventory\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`inventory\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`unloading\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`unloading\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`package_dispatch\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`route_closure\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`route_closure\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'recibido_en_bodega', 'pendiente', 'en_ruta', 'en_transito', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre', 'en_bodega', 'estacion_fedex', 'llegado_despues', 'direccion_incorrecta', 'cliente_no_disponible', 'cambio_fecha_solicitado', 'acargo_de_fedex', 'entregado_por_fedex', 'retorno_abandono_fedex') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` CHANGE \`status\` \`status\` enum ('recoleccion', 'recibido_en_bodega', 'pendiente', 'en_ruta', 'en_transito', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre', 'en_bodega', 'retenido_por_fedex', 'estacion_fedex', 'llegado_despues', 'direccion_incorrecta', 'cliente_no_disponible', 'cambio_fecha_solicitado', 'acargo_de_fedex', 'entregado_por_fedex', 'retorno_abandono_fedex') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`route\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`route\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`driver\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`driver\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`charge\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`charge\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`vehicle\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`vehicle\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`createdById\``);
        await queryRunner.query(`ALTER TABLE \`subsidiary\` ADD \`createdById\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` DROP COLUMN \`chargeShipmentId\``);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` DROP COLUMN \`shipmentId\``);
        await queryRunner.query(`ALTER TABLE \`for-pick-up\` DROP COLUMN \`createdById\``);
    }

}
