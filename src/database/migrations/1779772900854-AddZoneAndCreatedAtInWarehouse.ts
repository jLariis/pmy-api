import { MigrationInterface, QueryRunner } from "typeorm";

export class AddZoneAndCreatedAtInWarehouse1779772900854 implements MigrationInterface {
    name = 'AddZoneAndCreatedAtInWarehouse1779772900854'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Crear tabla zone
        await queryRunner.query(`
            CREATE TABLE \`zone\` (
                \`id\` varchar(36) NOT NULL,
                \`name\` varchar(100) NOT NULL,
                \`description\` varchar(255) NULL,
                \`createdById\` varchar(255) NULL,
                \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB
        `);

        // FK de zone.createdById -> user.id
        await queryRunner.query(`
            ALTER TABLE \`zone\`
            ADD CONSTRAINT \`FK_2891677a10dc9e99fd697e6f66f\`
            FOREIGN KEY (\`createdById\`)
            REFERENCES \`user\`(\`id\`)
            ON DELETE NO ACTION
            ON UPDATE NO ACTION
        `);

          // Agregar columna zoneId a subsidiary
        await queryRunner.query(`
            ALTER TABLE \`subsidiary\`
            ADD \`zoneId\` varchar(36) NULL
        `);

        // Crear índice para zoneId
        await queryRunner.query(`
            CREATE INDEX \`IDX_subsidiary_zoneId\`
            ON \`subsidiary\` (\`zoneId\`)
        `);

        // Crear foreign key subsidiary.zoneId -> zone.id
        await queryRunner.query(`
            ALTER TABLE \`subsidiary\`
            ADD CONSTRAINT \`FK_subsidiary_zone\`
            FOREIGN KEY (\`zoneId\`)
            REFERENCES \`zone\`(\`id\`)
            ON DELETE SET NULL
            ON UPDATE NO ACTION
        `);

    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Eliminar FK de zone
        await queryRunner.query(`
            ALTER TABLE \`zone\`
            DROP FOREIGN KEY \`FK_2891677a10dc9e99fd697e6f66f\`
        `);

        // Eliminar tabla zone
        await queryRunner.query(`
            DROP TABLE \`zone\`
        `);

        // Eliminar foreign key
        await queryRunner.query(`
            ALTER TABLE \`subsidiary\`
            DROP FOREIGN KEY \`FK_subsidiary_zone\`
        `);

        // Eliminar índice
        await queryRunner.query(`
            DROP INDEX \`IDX_subsidiary_zoneId\`
            ON \`subsidiary\`
        `);

        // Eliminar columna
        await queryRunner.query(`
            ALTER TABLE \`subsidiary\`
            DROP COLUMN \`zoneId\`
        `);
    }
}