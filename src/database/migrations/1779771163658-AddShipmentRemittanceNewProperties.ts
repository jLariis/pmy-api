import { MigrationInterface, QueryRunner } from "typeorm";

export class AddShipmentRemittanceNewProperties1779771163658 implements MigrationInterface {
    name = 'AddShipmentRemittanceNewProperties1779771163658'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            ADD \`status\` enum (
                'recoleccion',
                'recibido_en_bodega',
                'pendiente',
                'en_ruta',
                'en_transito',
                'entregado',
                'no_entregado',
                'desconocido',
                'rechazado',
                'devuelto_a_fedex',
                'es_ocurre',
                'en_bodega',
                'retorno_abandono_fedex',
                'estacion_fedex',
                'llegado_despues',
                'direccion_incorrecta',
                'cliente_no_disponible',
                'cambio_fecha_solicitado',
                'acargo_de_fedex',
                'entregado_por_fedex',
                'demora_en_entrega',
                'empresa_cerrada',
                'no_se_pudo_recolectar_el_cobro',
                'otro'
            ) NOT NULL
        `);

        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            ADD \`dispatchId\` varchar(255) NULL
        `);

        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            ADD \`warehouseReceivingId\` varchar(255) NULL
        `);

        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            ADD \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        `);

        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            ADD CONSTRAINT \`FK_50ae037f070956f6b2cc6961672\`
            FOREIGN KEY (\`dispatchId\`)
            REFERENCES \`package_dispatch\`(\`id\`)
            ON DELETE SET NULL
            ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            ADD CONSTRAINT \`FK_shipment_remittance_warehouse_receiving\`
            FOREIGN KEY (\`warehouseReceivingId\`)
            REFERENCES \`warehouse_receiving\`(\`id\`)
            ON DELETE NO ACTION
            ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            DROP FOREIGN KEY \`FK_shipment_remittance_warehouse_receiving\`
        `);

        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            DROP FOREIGN KEY \`FK_50ae037f070956f6b2cc6961672\`
        `);

        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            DROP COLUMN \`createdAt\`
        `);

        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            DROP COLUMN \`warehouseReceivingId\`
        `);

        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            DROP COLUMN \`dispatchId\`
        `);

        await queryRunner.query(`
            ALTER TABLE \`shipment_remittance\`
            DROP COLUMN \`status\`
        `);
    }
}