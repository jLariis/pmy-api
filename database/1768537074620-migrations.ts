import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1768537074620 implements MigrationInterface {
    name = 'Migrations1768537074620'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP FOREIGN KEY \`FK_2944dbee3f9f0ae16a3dac97754\``);
        await queryRunner.query(`DROP INDEX \`REL_2944dbee3f9f0ae16a3dac9775\` ON \`charge_shipment\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` DROP COLUMN \`paymentId\``);
        await queryRunner.query(`ALTER TABLE \`invetory\` ADD \`type\` enum ('initial', 'dex', 'final') NULL DEFAULT 'initial'`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` CHANGE \`status\` \`status\` enum ('recoleccion', 'recibido_en_bodega', 'pendiente', 'en_ruta', 'en_transito', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre', 'en_bodega', 'retenido_por_fedex', 'estacion_fedex', 'llegado_despues', 'direccion_incorrecta', 'cliente_no_disponible') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'recibido_en_bodega', 'pendiente', 'en_ruta', 'en_transito', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre', 'en_bodega', 'retenido_por_fedex', 'estacion_fedex', 'llegado_despues', 'direccion_incorrecta', 'cliente_no_disponible') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'recibido_en_bodega', 'pendiente', 'en_ruta', 'en_transito', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre', 'en_bodega', 'retenido_por_fedex', 'estacion_fedex', 'llegado_despues', 'direccion_incorrecta', 'cliente_no_disponible') NOT NULL DEFAULT 'pendiente'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido', 'rechazado', 'devuelto_a_fedex', 'es_ocurre') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`invetory\` DROP COLUMN \`type\``);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD \`paymentId\` varchar(36) NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`REL_2944dbee3f9f0ae16a3dac9775\` ON \`charge_shipment\` (\`paymentId\`)`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` ADD CONSTRAINT \`FK_2944dbee3f9f0ae16a3dac97754\` FOREIGN KEY (\`paymentId\`) REFERENCES \`payment\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}
