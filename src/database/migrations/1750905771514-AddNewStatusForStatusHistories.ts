import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNewStatusForStatusHistories1750905771514 implements MigrationInterface {
    name = 'AddNewStatusForStatusHistories1750905771514'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shipment_status\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido') NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado', 'desconocido') NOT NULL DEFAULT 'pendiente'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`charge_shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`shipment\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado') NOT NULL DEFAULT 'pendiente'`);
        await queryRunner.query(`ALTER TABLE \`shipment_status\` CHANGE \`status\` \`status\` enum ('recoleccion', 'pendiente', 'en_ruta', 'entregado', 'no_entregado') NOT NULL`);
    }

}
